/**
 * Test helper: loads an IIFE source file and returns the global it creates.
 *
 * How it works:
 *   1. Reads the .js file as a string.
 *   2. Wraps it in a Function that receives mocked globals.
 *   3. Executes it in a sandbox object, then returns the requested global.
 *
 * Usage:
 *   const LexeraTemplates = loadIIFE('templates.js', 'LexeraTemplates', {
 *     lexeraLog: vi.fn()
 *   });
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

/**
 * @param {string|string[]} filename    File inside src/ (or array of files, concatenated in order)
 * @param {string}          globalName  The global variable the IIFE assigns, e.g. 'LexeraTemplates'
 * @param {object}          [globals={}]  Extra globals to inject (e.g. { lexeraLog: vi.fn() })
 * @returns {any}                       The value of the requested global after execution
 */
export function loadIIFE(filename, globalName, globals = {}) {
  const files = Array.isArray(filename) ? filename : [filename];
  const sources = files.map((f) => readFileSync(resolve(srcDir, f), 'utf-8'));
  const combined = sources.join('\n');

  // Build a sandbox with the mocked globals
  const sandbox = { ...globals };

  // The IIFE assigns to `var LexeraTemplates = (function(){ ... })();`
  // We need to execute this so the assignment happens.
  // Strategy: wrap source in a function body that has access to the globals,
  // then return the assigned global name.
  const wrappedSource = `
    ${combined}
    return ${globalName};
  `;

  // Build argument names and values from the globals object
  const argNames = Object.keys(sandbox);
  const argValues = argNames.map(k => sandbox[k]);

  // Create a function that takes the globals as arguments and runs the source
  const factory = new Function(...argNames, wrappedSource);
  return factory(...argValues);
}
