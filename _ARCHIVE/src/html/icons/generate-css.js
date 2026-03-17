#!/usr/bin/env node
/**
 * Generate CSS data URIs from SVG icon files
 * Run this after modifying any heading-*.svg file:
 *   node src/html/icons/generate-css.js
 *
 * Then copy the output to webview.css
 */

const fs = require('fs');
const path = require('path');

const iconsDir = __dirname;

for (let i = 1; i <= 6; i++) {
    const svgPath = path.join(iconsDir, `heading-${i}.svg`);
    let svg = fs.readFileSync(svgPath, 'utf8');

    // Strip Inkscape/Sodipodi metadata
    svg = svg
        // Remove XML declaration
        .replace(/<\?xml[^?]*\?>\s*/g, '')
        // Remove sodipodi:namedview element
        .replace(/<sodipodi:namedview[^>]*\/>/g, '')
        .replace(/<sodipodi:namedview[^>]*>[\s\S]*?<\/sodipodi:namedview>/g, '')
        // Remove defs if empty
        .replace(/<defs[^>]*\/>/g, '')
        .replace(/<defs[^>]*>\s*<\/defs>/g, '')
        // Remove inkscape/sodipodi attributes from svg element
        .replace(/\s+xmlns:inkscape='[^']*'/g, '')
        .replace(/\s+xmlns:sodipodi='[^']*'/g, '')
        .replace(/\s+inkscape:[a-z-]+='[^']*'/g, '')
        .replace(/\s+sodipodi:[a-z-]+='[^']*'/g, '')
        .replace(/\s+xmlns:inkscape="[^"]*"/g, '')
        .replace(/\s+xmlns:sodipodi="[^"]*"/g, '')
        .replace(/\s+inkscape:[a-z-]+="[^"]*"/g, '')
        .replace(/\s+sodipodi:[a-z-]+="[^"]*"/g, '')
        // Remove version and id attributes
        .replace(/\s+version='[^']*'/g, '')
        .replace(/\s+version="[^"]*"/g, '')
        .replace(/\s+id='[^']*'/g, '')
        .replace(/\s+id="[^"]*"/g, '')
        // Remove comments
        .replace(/<!--[\s\S]*?-->/g, '')
        // Clean up whitespace
        .replace(/\n/g, '')
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .trim();

    // Convert to data URI (encode special chars)
    const encoded = svg
        .replace(/"/g, "'")
        .replace(/#/g, '%23')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E');

    console.log(`/* H${i} */`);
    console.log(`.markdown-content h${i}::before {`);
    console.log(`  background-image: url("data:image/svg+xml,${encoded}");`);
    console.log(`}`);
}
