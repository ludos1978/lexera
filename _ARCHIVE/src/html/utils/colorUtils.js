/**
 * Color Utility Module
 * Provides color conversion and validation functions
 */

class ColorUtils {
    /**
     * Convert hex color to RGB
     * @param {string} hex - Hex color string (#RRGGBB or #RGB)
     * @returns {Object|null} RGB object {r, g, b} or null if invalid
     */
    hexToRgb(hex) {
        // Remove # if present
        hex = hex.replace(/^#/, '');

        // Handle 3-digit hex
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }

        // Validate hex format
        if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return null;
        }

        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        return { r, g, b };
    }

    /**
     * Convert RGB to hex color
     * @param {number} r - Red value (0-255)
     * @param {number} g - Green value (0-255)
     * @param {number} b - Blue value (0-255)
     * @returns {string} Hex color string with #
     */
    rgbToHex(r, g, b) {
        // Ensure values are within range
        r = Math.max(0, Math.min(255, Math.round(r)));
        g = Math.max(0, Math.min(255, Math.round(g)));
        b = Math.max(0, Math.min(255, Math.round(b)));

        const toHex = (n) => {
            const hex = n.toString(16).padStart(2, '0');
            return hex.toUpperCase();
        };

        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }


    /**
     * Parse any color format to RGB
     * @param {string} color - Color in any format (hex, rgb, rgba)
     * @returns {Object|null} RGB object or null if invalid
     */
    parseToRgb(color) {
        // Guard against undefined/null color
        if (!color || typeof color !== 'string') {
            return null;
        }

        // Try hex format
        if (color.startsWith('#')) {
            return this.hexToRgb(color);
        }

        // Try rgb/rgba format
        const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1], 10),
                g: parseInt(rgbMatch[2], 10),
                b: parseInt(rgbMatch[3], 10)
            };
        }

        return null;
    }

    /**
     * Interpolates between two colors for gradient effects
     * @param {string} color1 - Starting hex color
     * @param {string} color2 - Ending hex color
     * @param {number} factor - Interpolation factor (0-1)
     * @returns {string} Interpolated hex color
     */
    interpolateColor(color1, color2, factor) {
        // Parse colors using internal methods
        const c1 = this.hexToRgb(color1);
        const c2 = this.hexToRgb(color2);

        if (!c1 || !c2) {
            return color1; // Fallback if parsing fails
        }

        // Interpolate each component
        const r = Math.round(c1.r + (c2.r - c1.r) * factor);
        const g = Math.round(c1.g + (c2.g - c1.g) * factor);
        const b = Math.round(c1.b + (c2.b - c1.b) * factor);

        return this.rgbToHex(r, g, b);
    }

    /**
     * Calculate relative luminance of a color (WCAG standard)
     * @param {string} color - Color in any format
     * @returns {number} Luminance value (0-1)
     */
    getLuminance(color) {
        const rgb = this.parseToRgb(color);
        if (!rgb) return 0.5; // Default to mid luminance if parsing fails

        // Convert RGB to linear RGB
        const toLinear = (val) => {
            const normalized = val / 255;
            return normalized <= 0.03928
                ? normalized / 12.92
                : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };

        const r = toLinear(rgb.r);
        const g = toLinear(rgb.g);
        const b = toLinear(rgb.b);

        // Calculate relative luminance using WCAG formula
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /**
     * Determine if dark text should be used on a background color
     * Uses WCAG contrast guidelines with theme-aware threshold
     * @param {string} backgroundColor - Background color
     * @param {boolean} isDarkMode - Whether dark mode is active (optional, auto-detected if not provided)
     * @returns {boolean} True if dark text should be used
     */
    shouldUseDarkText(backgroundColor, isDarkMode = null) {
        const luminance = this.getLuminance(backgroundColor);
        // WCAG 2.0 standard: use threshold of sqrt(1.05 * 0.05) - 0.05 ≈ 0.179
        // This ensures contrast ratio >= 4.5:1 for both black and white text
        // In dark mode, use a higher threshold (0.35) to favor white text more often
        // for better readability against dark UI backgrounds
        const darkMode = isDarkMode !== null ? isDarkMode : this._isDarkMode();
        const threshold = darkMode ? 0.35 : 0.179;
        return luminance > threshold;
    }

    /**
     * Internal helper to detect dark mode
     * @returns {boolean} True if dark mode is active
     */
    _isDarkMode() {
        if (typeof window !== 'undefined' && typeof window.isDarkTheme === 'function') {
            return window.isDarkTheme();
        }
        if (typeof document !== 'undefined' && document.body) {
            return document.body.classList.contains('vscode-dark') ||
                   document.body.classList.contains('vscode-high-contrast');
        }
        return false;
    }

    /**
     * Get appropriate text color (black or white) for a background
     * @param {string} backgroundColor - Background color
     * @returns {string} Either '#000000' or '#ffffff'
     */
    getContrastText(backgroundColor) {
        return this.shouldUseDarkText(backgroundColor) ? '#000000' : '#ffffff';
    }

    /**
     * Calculate contrast ratio between two colors (WCAG standard)
     * @param {string} color1 - First color
     * @param {string} color2 - Second color
     * @returns {number} Contrast ratio (1-21)
     */
    getContrastRatio(color1, color2) {
        const lum1 = this.getLuminance(color1);
        const lum2 = this.getLuminance(color2);

        const lighter = Math.max(lum1, lum2);
        const darker = Math.min(lum1, lum2);

        return (lighter + 0.05) / (darker + 0.05);
    }

    /**
     * Get text shadow for better contrast
     * Creates an outline effect when contrast is poor
     * @param {string} textColor - Text color
     * @param {string} backgroundColor - Background color
     * @returns {string} CSS text-shadow value or empty string
     */
    getContrastShadow(textColor, backgroundColor) {
        const ratio = this.getContrastRatio(textColor, backgroundColor);

        // If contrast is good (ratio >= 4.5), no shadow needed
        if (ratio >= 4.5) {
            return '';
        }

        // For poor contrast, add outline shadow
        // Use the opposite color of the text for the outline
        const outlineColor = this.shouldUseDarkText(backgroundColor) ? '#ffffff' : '#000000';

        // Create a multi-directional outline effect
        // return `0 0 2px ${outlineColor}, 0 0 2px ${outlineColor}, 0 0 2px ${outlineColor}`;
        // Smoother and less obstucting
        return `0 0 4px #888`;
    }

    /**
     * Get text outline shadow for tag pills
     * Returns a crisp outline in the contrast color, with larger blur for low contrast
     * @param {string} textColor - The text color being used
     * @param {string} backgroundColor - The background color for contrast calculation
     * @returns {string} CSS text-shadow value for outline effect
     */
    getTagTextOutline(textColor, backgroundColor) {
        // Use opposite color for outline (white text gets black outline, vice versa)
        const outlineColor = textColor === '#ffffff' ? '#222' : '#ddd';

        // Calculate contrast ratio to determine outline strength
        const ratio = this.getContrastRatio(textColor, backgroundColor);

        // Use larger blur radius for low contrast, fewer layers (larger blur is softer)
        // Good contrast (>7): 1px blur, 6 layers
        // Medium (4.5-7): 3px blur, 4 layers
        // Poor (<4.5): 5px blur, 2 layers
        let blurRadius, layers;
        if (ratio >= 7) {
            blurRadius = 2;
            layers = 3;
        } else if (ratio >= 4.5) {
            blurRadius = 4;
            layers = 2;
        } else {
            blurRadius = 6;
            layers = 1;
        }

        // Multiple layered shadows at same position create a crisp outline effect
        const shadow = `${outlineColor} 0px 0px ${blurRadius}px`;
        return Array(layers).fill(shadow).join(', ');
    }

    /**
     * Convert RGB to HSL
     * @param {number} r - Red (0-255)
     * @param {number} g - Green (0-255)
     * @param {number} b - Blue (0-255)
     * @returns {Object} {h: 0-360, s: 0-100, l: 0-100}
     */
    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    /**
     * Convert HSL to RGB
     * @param {number} h - Hue (0-360)
     * @param {number} s - Saturation (0-100)
     * @param {number} l - Lightness (0-100)
     * @returns {Object} {r, g, b} each 0-255
     */
    hslToRgb(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        if (s === 0) {
            const v = Math.round(l * 255);
            return { r: v, g: v, b: v };
        }
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return {
            r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
            g: Math.round(hue2rgb(p, q, h) * 255),
            b: Math.round(hue2rgb(p, q, h - 1/3) * 255)
        };
    }

    /**
     * Convert hex to HSL
     * @param {string} hex - Hex color string
     * @returns {Object|null} {h, s, l} or null if invalid
     */
    hexToHsl(hex) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return null;
        return this.rgbToHsl(rgb.r, rgb.g, rgb.b);
    }

    /**
     * Convert HSL to hex
     * @param {number} h - Hue (0-360)
     * @param {number} s - Saturation (0-100)
     * @param {number} l - Lightness (0-100)
     * @returns {string} Hex color string with #
     */
    hslToHex(h, s, l) {
        const rgb = this.hslToRgb(h, s, l);
        return this.rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    /**
     * Convert RGB to HSV
     * @param {number} r - Red (0-255)
     * @param {number} g - Green (0-255)
     * @param {number} b - Blue (0-255)
     * @returns {Object} {h: 0-360, s: 0-100, v: 0-100}
     */
    rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        const v = max;
        const s = max === 0 ? 0 : d / max;
        if (max === min) return { h: 0, s: 0, v: Math.round(v * 100) };
        let h;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
        return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
    }

    /**
     * Convert HSV to RGB
     * @param {number} h - Hue (0-360)
     * @param {number} s - Saturation (0-100)
     * @param {number} v - Value (0-100)
     * @returns {Object} {r, g, b} each 0-255
     */
    hsvToRgb(h, s, v) {
        h /= 360; s /= 100; v /= 100;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        let r, g, b;
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    }

    /**
     * Get both text color and text shadow for a background color
     * Combines getContrastText() and getContrastShadow() in a single call
     * to avoid duplicate luminance/contrast calculations
     * @param {string} backgroundColor - Background color
     * @returns {Object} Object with textColor and textShadow properties
     */
    getTextColorsForBackground(backgroundColor) {
        const textColor = this.getContrastText(backgroundColor);
        const textShadow = this.getContrastShadow(textColor, backgroundColor);
        return { textColor, textShadow };
    }

    /**
     * Get text color and outline for tag pills with background colors
     * Always includes outline shadow for better readability
     * @param {string} backgroundColor - Background color of the tag
     * @returns {Object} Object with textColor and textOutline properties
     */
    getTagTextColors(backgroundColor) {
        const textColor = this.getContrastText(backgroundColor);
        const textOutline = this.getTagTextOutline(textColor, backgroundColor);
        return { textColor, textOutline };
    }
}

// Create singleton instance
const colorUtils = new ColorUtils();

// Global window exposure
if (typeof window !== 'undefined') {
    window.colorUtils = colorUtils;
}