//! Windows-only helpers for per-user ACLs on the descriptor file and
//! same-user peer-SID verification on named-pipe accept.
//!
//! Gap #3 from IPC-Migration-Plan.md: match the Unix defense-in-depth story
//! (filesystem mode `0600` + `SO_PEERCRED` / `getpeereid`) on Windows.
//!
//! The module is only compiled on `cfg(windows)`. It is kept in a standalone
//! file so the `unsafe` Win32 code is isolated and testable on a Windows
//! host without touching the cross-platform modules.
//!
//! # Security descriptor
//!
//! SDDL `D:P(A;;GA;;;OW)` — DACL, protected (no inheritance), allow
//! generic-all to the object's owner (the creator's SID after the
//! descriptor is applied).
//!
//! # Peer-SID verification
//!
//! On accept, query the named pipe's client process id
//! (`GetNamedPipeClientProcessId`), open the process token
//! (`OpenProcessToken` with `TOKEN_QUERY`), read the `TokenUser` SID, and
//! compare it to the current process's user SID via `EqualSid`. Rejects
//! cross-session or cross-user peers even if they somehow bypassed the
//! restricted pipe ACL.

#![cfg(windows)]

use crate::error::IpcError;
use std::os::windows::io::{AsRawHandle, RawHandle};
use std::path::Path;
use windows_sys::core::PWSTR;
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
    EqualSid, GetTokenInformation, TokenUser, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::SetFileSecurityW;
use windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// SDDL for a protected DACL granting the file/pipe owner sole generic-all.
const OWNER_ONLY_SDDL: &str = "D:P(A;;GA;;;OW)";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Allocate a self-relative security descriptor from an SDDL string.
/// Caller must `LocalFree(psd)` once applied.
fn sd_from_sddl(sddl: &str) -> Result<PSECURITY_DESCRIPTOR, IpcError> {
    let sddl_w = wide(sddl);
    let mut psd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl_w.as_ptr(),
            SDDL_REVISION_1 as u32,
            &mut psd,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 || psd.is_null() {
        return Err(IpcError::Descriptor(format!(
            "ConvertStringSecurityDescriptorToSecurityDescriptorW failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(psd)
}

/// Restrict an existing file to the current user via SDDL. Call this after
/// writing the descriptor tempfile, before the atomic rename.
pub fn restrict_file_to_current_user(path: &Path) -> Result<(), IpcError> {
    let psd = sd_from_sddl(OWNER_ONLY_SDDL)?;
    let path_w = wide(&path.to_string_lossy());
    let ok = unsafe { SetFileSecurityW(path_w.as_ptr(), DACL_SECURITY_INFORMATION, psd as *mut _) };
    let err = std::io::Error::last_os_error();
    unsafe {
        LocalFree(psd as *mut _);
    }
    if ok == 0 {
        return Err(IpcError::Descriptor(format!(
            "SetFileSecurityW failed for {}: {}",
            path.display(),
            err
        )));
    }
    Ok(())
}

/// Build a `SECURITY_ATTRIBUTES` that only permits the current user.
/// The caller is responsible for freeing `lpSecurityDescriptor` via
/// `LocalFree` once the pipe is created.
///
/// Returns `(SECURITY_ATTRIBUTES, PSECURITY_DESCRIPTOR)` — keep both alive
/// across the `ServerOptions::create` call, then free the PSD.
pub fn owner_only_security_attributes(
) -> Result<(SECURITY_ATTRIBUTES, PSECURITY_DESCRIPTOR), IpcError> {
    let psd = sd_from_sddl(OWNER_ONLY_SDDL)?;
    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: psd,
        bInheritHandle: 0,
    };
    Ok((sa, psd))
}

/// Query the current process's user SID into a heap buffer. Returned bytes
/// are a self-contained `TOKEN_USER` structure whose `.User.Sid` pointer is
/// valid for the lifetime of the buffer.
fn process_user_sid(pid: u32) -> Result<Vec<u8>, IpcError> {
    unsafe {
        let proc_handle: HANDLE = if pid == 0 {
            GetCurrentProcess()
        } else {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
        };
        if proc_handle == 0 {
            return Err(IpcError::Descriptor(format!(
                "OpenProcess({}) failed: {}",
                pid,
                std::io::Error::last_os_error()
            )));
        }

        let mut token: HANDLE = 0;
        let ok = OpenProcessToken(proc_handle, TOKEN_QUERY, &mut token);
        // Current-process handle is a pseudo-handle; no need to close.
        let is_pseudo = pid == 0;
        if !is_pseudo {
            CloseHandle(proc_handle);
        }
        if ok == 0 {
            return Err(IpcError::Descriptor(format!(
                "OpenProcessToken failed: {}",
                std::io::Error::last_os_error()
            )));
        }

        // Two-step GetTokenInformation: size, then allocate, then read.
        let mut needed: u32 = 0;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        if needed == 0 {
            CloseHandle(token);
            return Err(IpcError::Descriptor(
                "GetTokenInformation size query returned 0".into(),
            ));
        }
        let mut buf = vec![0u8; needed as usize];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buf.as_mut_ptr() as *mut _,
            needed,
            &mut needed,
        );
        CloseHandle(token);
        if ok == 0 {
            return Err(IpcError::Descriptor(format!(
                "GetTokenInformation read failed: {}",
                std::io::Error::last_os_error()
            )));
        }
        Ok(buf)
    }
}

fn token_user_sid_ptr(buf: &[u8]) -> *const std::ffi::c_void {
    let tu: *const TOKEN_USER = buf.as_ptr() as *const TOKEN_USER;
    unsafe { (*tu).User.Sid as *const _ }
}

/// Verify the named-pipe client is the same OS user as the server. Called
/// after `NamedPipeServer::connect()` completes, before the handshake.
/// Returns `Err(CrossUser)` on mismatch; logs but does not fail if the SID
/// query itself errors (defense in depth leaves the secret handshake as
/// the remaining gate).
pub fn verify_pipe_peer_same_user<H: AsRawHandle>(pipe: &H) -> Result<(), IpcError> {
    let raw: RawHandle = pipe.as_raw_handle();
    let handle: HANDLE = raw as HANDLE;
    let mut peer_pid: u32 = 0;
    let ok = unsafe { GetNamedPipeClientProcessId(handle, &mut peer_pid) };
    if ok == 0 {
        return Err(IpcError::Descriptor(format!(
            "GetNamedPipeClientProcessId failed: {}",
            std::io::Error::last_os_error()
        )));
    }

    let peer_buf = process_user_sid(peer_pid)?;
    let own_buf = process_user_sid(0)?;

    let peer_sid = token_user_sid_ptr(&peer_buf);
    let own_sid = token_user_sid_ptr(&own_buf);

    let equal = unsafe { EqualSid(peer_sid as *mut _, own_sid as *mut _) };
    if equal == 0 {
        return Err(IpcError::CrossUser {
            peer: peer_pid,
            server: std::process::id(),
        });
    }
    Ok(())
}
