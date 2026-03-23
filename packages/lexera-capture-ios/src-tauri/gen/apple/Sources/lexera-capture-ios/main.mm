#include "bindings/bindings.h"
#import <Foundation/Foundation.h>

int main(int argc, char * argv[]) {
	// Set App Group container path for the Rust backend.
	// IosStorage reads LEXERA_APP_GROUP_PATH to find shared boards/pending data.
	NSString *groupID = @"group.com.lexera.capture";
	NSURL *containerURL = [[NSFileManager defaultManager]
		containerURLForSecurityApplicationGroupIdentifier:groupID];
	if (containerURL) {
		setenv("LEXERA_APP_GROUP_PATH", containerURL.path.UTF8String, 1);
		NSLog(@"[LexeraCapture] App Group path: %@", containerURL.path);
	} else {
		NSLog(@"[LexeraCapture] App Group not available, using app sandbox");
	}

	ffi::start_app();
	return 0;
}
