/**
 * ColorPickerComponent
 * Custom color picker popup with 4 modes: Palette, HSL sliders, RGB sliders, Color map.
 * Internal model uses HSV. Display adapts to selected mode.
 */

class ColorPickerComponent {
    constructor() {
        this._popup = null;
        this._trigger = null;
        this._onChange = null;
        this._mode = 'palette'; // palette | hsl | rgb | color
        // Internal HSV state
        this._hue = 0;       // 0-360
        this._sat = 100;     // 0-100 (HSV saturation)
        this._val = 100;     // 0-100 (HSV value)
        this._dragging = null; // { type: 'slider'|'color', channel?: string, canvas: element } | null
        this._boundOnMouseMove = this._onMouseMove.bind(this);
        this._boundOnMouseUp = this._onMouseUp.bind(this);
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        this._boundOnClickOutside = this._onClickOutside.bind(this);
        this._boundOnWindowBlur = this.close.bind(this);
        this._injectStyles();
    }

    // ============= Public API =============

    open(triggerElement, initialHexColor, onChangeCallback) {
        this.close();
        this._trigger = triggerElement;
        this._onChange = onChangeCallback;
        // Parse initial color to HSV
        const rgb = window.colorUtils.hexToRgb(initialHexColor || '#FF0000');
        if (rgb) {
            const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
            this._hue = hsv.h;
            this._sat = hsv.s;
            this._val = hsv.v;
        }
        this._createPopup();
        this._positionPopup();
        this._renderAll();
        // Defer event binding so the triggering click doesn't immediately close
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this._boundOnClickOutside, true);
            document.addEventListener('keydown', this._boundOnKeyDown, true);
            window.addEventListener('blur', this._boundOnWindowBlur);
        });
    }

    close() {
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }
        this._trigger = null;
        this._onChange = null;
        this._dragging = null;
        document.removeEventListener('mousedown', this._boundOnClickOutside, true);
        document.removeEventListener('keydown', this._boundOnKeyDown, true);
        document.removeEventListener('mousemove', this._boundOnMouseMove, true);
        document.removeEventListener('mouseup', this._boundOnMouseUp, true);
        window.removeEventListener('blur', this._boundOnWindowBlur);
    }

    isOpen() {
        return this._popup !== null;
    }

    // ============= Popup Construction =============

    _createPopup() {
        const popup = document.createElement('div');
        popup.className = 'cp-popup';
        popup.innerHTML = '<div class="cp-content"></div>' +
            '<div class="cp-controls">' +
                '<div class="cp-preview"></div>' +
                '<button class="cp-mode-btn">' + this._modeLabel() + '</button>' +
            '</div>';

        document.body.appendChild(popup);
        this._popup = popup;
        this._contentArea = popup.querySelector('.cp-content');
        this._preview = popup.querySelector('.cp-preview');
        this._modeBtn = popup.querySelector('.cp-mode-btn');
        this._modeBtn.addEventListener('click', () => this._cycleMode());
        this._buildModeContent();
    }

    _modeLabel() {
        return { palette: 'PAL', hsl: 'HSL', rgb: 'RGB', color: 'COL' }[this._mode];
    }

    _positionPopup() {
        if (!this._trigger || !this._popup) return;
        const rect = this._trigger.getBoundingClientRect();
        const pw = 174, ph = this._popup.offsetHeight;
        let top = rect.bottom + 4;
        let left = Math.max(4, (window.innerWidth - pw) / 2);
        if (top + ph > window.innerHeight) top = Math.max(4, rect.top - ph - 4);
        this._popup.style.top = top + 'px';
        this._popup.style.left = left + 'px';
    }

    // ============= Mode Switching =============

    _cycleMode() {
        const modes = ['palette', 'hsl', 'rgb', 'color'];
        const idx = modes.indexOf(this._mode);
        this._mode = modes[(idx + 1) % modes.length];
        this._modeBtn.textContent = this._modeLabel();
        this._buildModeContent();
        this._renderAll();
        this._positionPopup();
    }

    _buildModeContent() {
        const c = this._contentArea;
        if (this._mode === 'palette') {
            c.innerHTML = this._buildPaletteHtml();
            c.querySelectorAll('.cp-swatch').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    const hex = swatch.dataset.color;
                    const rgb = window.colorUtils.hexToRgb(hex);
                    if (rgb) {
                        const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
                        this._hue = hsv.h;
                        this._sat = hsv.s;
                        this._val = hsv.v;
                        this._renderAll();
                        this._emitChange();
                    }
                });
            });
        } else if (this._mode === 'hsl') {
            c.innerHTML = this._buildSlidersHtml(['H', 'S', 'L'], [360, 100, 100]);
            this._attachSliderListeners(c);
        } else if (this._mode === 'rgb') {
            c.innerHTML = this._buildSlidersHtml(['R', 'G', 'B'], [255, 255, 255]) +
                '<div class="cp-hex-row">' +
                    '<span class="cp-slider-label">#</span>' +
                    '<input type="text" class="cp-hex-input" maxlength="6">' +
                '</div>';
            this._attachSliderListeners(c);
            const hexInput = c.querySelector('.cp-hex-input');
            if (hexInput) {
                const handler = () => this._onHexInput(hexInput.value);
                hexInput.addEventListener('change', handler);
                hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
            }
        } else if (this._mode === 'color') {
            c.innerHTML = '<canvas class="cp-color-canvas" width="160" height="60"></canvas>' +
                '<div class="cp-color-info"></div>';
            const canvas = c.querySelector('.cp-color-canvas');
            canvas.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this._dragging = { type: 'color', canvas: canvas };
                this._applyDrag(e);
                document.addEventListener('mousemove', this._boundOnMouseMove, true);
                document.addEventListener('mouseup', this._boundOnMouseUp, true);
            });
        }
    }

    _buildPaletteHtml() {
        const flexoki = [
            { ref: '#9F9D96', shades: ['#F2F0E5','#E6E4D9','#DAD8CE','#CECDC3','#B7B5AC','#9F9D96','#878580','#6F6E69','#575653','#403E3C','#343331','#282726','#1C1B1A'] },
            { ref: '#D14D41', shades: ['#FFE1D5','#FFCABB','#FDB2A2','#F89A8A','#E8705F','#D14D41','#C03E35','#AF3029','#942822','#6C201C','#551B18','#3E1715','#261312'] },
            { ref: '#DA702C', shades: ['#FFE7CE','#FED3AF','#FCC192','#F9AE77','#EC8B49','#DA702C','#CB6120','#BC5215','#9D4310','#71320D','#59290D','#40200D','#27180E'] },
            { ref: '#D0A215', shades: ['#FAEEC6','#F6E2A0','#F1D67E','#ECCB60','#DFB431','#D0A215','#BE9207','#AD8301','#8E6B01','#664D01','#503D02','#3A2D04','#241E08'] },
            { ref: '#879A39', shades: ['#EDEECF','#DDE2B2','#CDD597','#BEC97E','#A0AF54','#879A39','#768D21','#66800B','#536907','#3D4C07','#313D07','#252D09','#1A1E0C'] },
            { ref: '#3AA99F', shades: ['#DDF1E4','#BFE8D9','#A2DECE','#87D3C3','#5ABDAC','#3AA99F','#2F968D','#24837B','#1C6C66','#164F4A','#143F3C','#122F2C','#101F1D'] },
            { ref: '#4385BE', shades: ['#E1ECEB','#C6DDE8','#ABCFE2','#92BFDB','#66A0C8','#4385BE','#3171B2','#205EA6','#1A4F8C','#163B66','#133051','#12253B','#101A24'] },
            { ref: '#8B7EC8', shades: ['#F0EAEC','#E2D9E9','#D3CAE6','#C4B9E0','#A699D0','#8B7EC8','#735EB5','#5E409D','#4F3685','#3C2A62','#31234E','#261C39','#1A1623'] },
            { ref: '#CE5D97', shades: ['#FEE4E5','#FCCFDA','#F9B9CF','#F4A4C2','#E47DA8','#CE5D97','#B74583','#A02F6F','#87285E','#641F46','#4F1B39','#39172B','#24131D'] },
        ];
        let html = '<div class="cp-palette">';
        for (const row of flexoki) {
            const hsl = window.colorUtils.hexToHsl(row.ref);
            const whitish = hsl ? window.colorUtils.hslToHex(hsl.h, hsl.s, 98) : '#FAFAFA';
            const blackish = hsl ? window.colorUtils.hslToHex(hsl.h, hsl.s, 2) : '#050505';
            const allColors = [whitish, ...row.shades, blackish];
            for (const color of allColors) {
                html += '<div class="cp-swatch" data-color="' + color + '" style="background:' + color + '" title="' + color + '"></div>';
            }
        }
        html += '</div>';
        return html;
    }

    _buildSlidersHtml(channels, maxValues) {
        let html = '';
        for (let i = 0; i < channels.length; i++) {
            html += '<div class="cp-slider-row">' +
                '<span class="cp-slider-label">' + channels[i] + '</span>' +
                '<canvas class="cp-slider-canvas" data-channel="' + channels[i] + '" width="110" height="12"></canvas>' +
                '<input type="number" class="cp-slider-value" data-channel="' + channels[i] + '" min="0" max="' + maxValues[i] + '">' +
                '</div>';
        }
        return html;
    }

    _attachSliderListeners(container) {
        container.querySelectorAll('.cp-slider-canvas').forEach(canvas => {
            canvas.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this._dragging = { type: 'slider', channel: canvas.dataset.channel, canvas: canvas };
                this._applyDrag(e);
                document.addEventListener('mousemove', this._boundOnMouseMove, true);
                document.addEventListener('mouseup', this._boundOnMouseUp, true);
            });
        });
        container.querySelectorAll('.cp-slider-value').forEach(input => {
            const handler = () => this._onSliderInput();
            input.addEventListener('change', handler);
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
        });
    }

    // ============= Rendering =============

    _renderAll() {
        this._renderPreview();
        if (this._mode === 'hsl' || this._mode === 'rgb') {
            this._renderSliders();
        } else if (this._mode === 'color') {
            this._renderColorCanvas();
        }
    }

    _renderPreview() {
        if (this._preview) this._preview.style.backgroundColor = this._currentHex();
    }

    _renderSliders() {
        const hsl = this._currentHsl();
        const rgb = this._currentRgb();
        this._contentArea.querySelectorAll('.cp-slider-canvas').forEach(canvas => {
            const ch = canvas.dataset.channel;
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;
            ctx.save();
            ctx.clearRect(0, 0, w, h);
            // Clip to a 4px-tall rounded bar centered vertically
            ctx.beginPath();
            ctx.roundRect(0, (h - 4) / 2, w, 4, 2);
            ctx.clip();

            const grad = ctx.createLinearGradient(0, 0, w, 0);
            const steps = ch === 'H' ? 12 : 10;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                let cr, cg, cb;
                if (ch === 'H') {
                    const c = window.colorUtils.hslToRgb(t * 360, hsl.s, hsl.l);
                    cr = c.r; cg = c.g; cb = c.b;
                } else if (ch === 'S') {
                    const c = window.colorUtils.hslToRgb(hsl.h, t * 100, hsl.l);
                    cr = c.r; cg = c.g; cb = c.b;
                } else if (ch === 'L') {
                    const c = window.colorUtils.hslToRgb(hsl.h, hsl.s, t * 100);
                    cr = c.r; cg = c.g; cb = c.b;
                } else if (ch === 'R') {
                    cr = Math.round(t * 255); cg = rgb.g; cb = rgb.b;
                } else if (ch === 'G') {
                    cr = rgb.r; cg = Math.round(t * 255); cb = rgb.b;
                } else {
                    cr = rgb.r; cg = rgb.g; cb = Math.round(t * 255);
                }
                grad.addColorStop(t, 'rgb(' + cr + ',' + cg + ',' + cb + ')');
            }
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);

            // Cursor position
            let value, max;
            if (ch === 'H') { value = hsl.h; max = 360; }
            else if (ch === 'S') { value = hsl.s; max = 100; }
            else if (ch === 'L') { value = hsl.l; max = 100; }
            else if (ch === 'R') { value = rgb.r; max = 255; }
            else if (ch === 'G') { value = rgb.g; max = 255; }
            else { value = rgb.b; max = 255; }
            ctx.restore();
            // Draw cursor knob on top (outside clip)
            this._drawSliderCursor(ctx, (value / max) * w, h / 2, 5);
        });

        // Update value inputs (skip if user is editing)
        this._contentArea.querySelectorAll('.cp-slider-value').forEach(input => {
            if (document.activeElement === input) return;
            const ch = input.dataset.channel;
            if (ch === 'H') input.value = hsl.h;
            else if (ch === 'S') input.value = hsl.s;
            else if (ch === 'L') input.value = hsl.l;
            else if (ch === 'R') input.value = rgb.r;
            else if (ch === 'G') input.value = rgb.g;
            else if (ch === 'B') input.value = rgb.b;
        });

        // Update hex input (RGB mode)
        if (this._mode === 'rgb') {
            const hexInput = this._contentArea.querySelector('.cp-hex-input');
            if (hexInput && document.activeElement !== hexInput) {
                hexInput.value = this._currentHex().substring(1);
            }
        }
    }

    _renderColorCanvas() {
        const canvas = this._contentArea.querySelector('.cp-color-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;

        // Horizontal hue gradient at full saturation and value
        const hueGrad = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i <= 6; i++) {
            const rgb = window.colorUtils.hsvToRgb((i / 6) * 360, 100, 100);
            hueGrad.addColorStop(i / 6, 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
        }
        ctx.fillStyle = hueGrad;
        ctx.fillRect(0, 0, w, h);

        // Vertical black overlay (top transparent, bottom black)
        const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, w, h);

        // Cursor
        const cx = (this._hue / 360) * w;
        const cy = (1 - this._val / 100) * h;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Update info display
        const info = this._contentArea.querySelector('.cp-color-info');
        if (info) {
            const rgb = this._currentRgb();
            info.textContent = 'R:' + rgb.r + ' G:' + rgb.g + ' B:' + rgb.b + '  ' + this._currentHex();
        }
    }

    _drawSliderCursor(ctx, x, y, radius) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // ============= Current Color Getters =============

    _currentRgb() {
        return window.colorUtils.hsvToRgb(this._hue, this._sat, this._val);
    }

    _currentHex() {
        const rgb = this._currentRgb();
        return window.colorUtils.rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    _currentHsl() {
        const rgb = this._currentRgb();
        const hsl = window.colorUtils.rgbToHsl(rgb.r, rgb.g, rgb.b);
        // Preserve hue for achromatic colors (lost in conversion but stored internally)
        if (hsl.s === 0 || hsl.l === 0 || hsl.l === 100) hsl.h = this._hue;
        if (hsl.l === 100 || hsl.l === 0) hsl.s = 100;
        return hsl;
    }

    // ============= Drag Interaction =============

    _onMouseMove(e) {
        if (this._dragging) this._applyDrag(e);
    }

    _onMouseUp() {
        this._dragging = null;
        document.removeEventListener('mousemove', this._boundOnMouseMove, true);
        document.removeEventListener('mouseup', this._boundOnMouseUp, true);
    }

    _applyDrag(e) {
        if (!this._dragging) return;

        if (this._dragging.type === 'slider') {
            const canvas = this._dragging.canvas;
            const ch = this._dragging.channel;
            const rect = canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

            if (this._mode === 'hsl') {
                const hsl = this._currentHsl();
                if (ch === 'H') hsl.h = Math.min(359, Math.round(x * 360));
                else if (ch === 'S') hsl.s = Math.round(x * 100);
                else if (ch === 'L') hsl.l = Math.round(x * 100);
                const rgb = window.colorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
                const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
                // Preserve hue/sat when converting through achromatic colors
                this._hue = (hsv.s === 0 && ch !== 'H') ? this._hue : (ch === 'H' ? hsl.h : hsv.h);
                this._sat = hsv.v === 0 ? this._sat : hsv.s;
                this._val = hsv.v;
            } else if (this._mode === 'rgb') {
                const rgb = this._currentRgb();
                if (ch === 'R') rgb.r = Math.round(x * 255);
                else if (ch === 'G') rgb.g = Math.round(x * 255);
                else if (ch === 'B') rgb.b = Math.round(x * 255);
                const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
                if (hsv.s === 0) hsv.h = this._hue;
                if (hsv.v === 0) { hsv.h = this._hue; hsv.s = this._sat; }
                this._hue = hsv.h; this._sat = hsv.s; this._val = hsv.v;
            }
        } else if (this._dragging.type === 'color') {
            const canvas = this._dragging.canvas;
            const rect = canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            this._hue = Math.min(359, Math.round(x * 360));
            this._sat = 100;
            this._val = Math.round((1 - y) * 100);
        }
        this._renderAll();
        this._emitChange();
    }

    // ============= Text Input Handling =============

    _onSliderInput() {
        const inputs = this._contentArea.querySelectorAll('.cp-slider-value');
        const vals = {};
        inputs.forEach(inp => vals[inp.dataset.channel] = parseInt(inp.value, 10) || 0);

        if (this._mode === 'hsl') {
            const h = Math.max(0, Math.min(360, vals.H || 0));
            const s = Math.max(0, Math.min(100, vals.S || 0));
            const l = Math.max(0, Math.min(100, vals.L || 0));
            const rgb = window.colorUtils.hslToRgb(h, s, l);
            const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
            this._hue = (hsv.s === 0) ? h : hsv.h;
            this._sat = hsv.v === 0 ? this._sat : hsv.s;
            this._val = hsv.v;
        } else if (this._mode === 'rgb') {
            const r = Math.max(0, Math.min(255, vals.R || 0));
            const g = Math.max(0, Math.min(255, vals.G || 0));
            const b = Math.max(0, Math.min(255, vals.B || 0));
            const hsv = window.colorUtils.rgbToHsv(r, g, b);
            if (hsv.s === 0) hsv.h = this._hue;
            if (hsv.v === 0) { hsv.h = this._hue; hsv.s = this._sat; }
            this._hue = hsv.h; this._sat = hsv.s; this._val = hsv.v;
        }
        this._renderAll();
        this._emitChange();
    }

    _onHexInput(hex) {
        hex = '#' + hex.replace(/^#/, '');
        const rgb = window.colorUtils.hexToRgb(hex);
        if (!rgb) return;
        const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
        this._hue = hsv.h; this._sat = hsv.s; this._val = hsv.v;
        this._renderAll();
        this._emitChange();
    }

    // ============= Events =============

    _emitChange() {
        if (this._onChange) this._onChange(this._currentHex());
    }

    _onKeyDown(e) {
        if (e.key === 'Escape') this.close();
    }

    _onClickOutside(e) {
        if (this._popup && !this._popup.contains(e.target) && e.target !== this._trigger) {
            this.close();
        }
    }

    // ============= Styles =============

    _injectStyles() {
        if (document.getElementById('color-picker-styles')) return;
        const style = document.createElement('style');
        style.id = 'color-picker-styles';
        style.textContent = `
.cp-popup {
    position: fixed;
    z-index: 10000;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    border-radius: 4px;
    padding: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.cp-controls {
    display: flex;
    align-items: center;
    gap: 4px;
}
.cp-preview {
    width: 22px;
    height: 22px;
    border-radius: 3px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    flex-shrink: 0;
}
.cp-mode-btn {
    width: 30px;
    padding: 2px 0;
    font-size: 10px;
    text-align: center;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 2px;
    cursor: pointer;
    flex-shrink: 0;
}
.cp-mode-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
}
.cp-palette {
    display: grid;
    grid-template-columns: repeat(15, 1fr);
    gap: 1px;
}
.cp-swatch {
    aspect-ratio: 1;
    border-radius: 1px;
    cursor: pointer;
    border: 0.5px solid rgba(128,128,128,0.3);
    min-height: 8px;
}
.cp-swatch:hover {
    box-shadow: inset 0 0 0 1.5px var(--vscode-focusBorder, #007fd4);
    z-index: 1;
    position: relative;
}
.cp-slider-row {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 3px;
}
.cp-slider-row:last-child {
    margin-bottom: 0;
}
.cp-slider-label {
    width: 12px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground, #888);
    text-align: center;
    flex-shrink: 0;
}
.cp-slider-canvas {
    cursor: pointer;
    display: block;
}
.cp-slider-value {
    width: 32px;
    box-sizing: border-box;
    padding: 2px 2px;
    font-size: 10px;
    text-align: center;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 2px;
    outline: none;
    flex-shrink: 0;
    -moz-appearance: textfield;
}
.cp-slider-value::-webkit-outer-spin-button,
.cp-slider-value::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.cp-hex-row {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-top: 3px;
}
.cp-hex-input {
    flex: 1;
    box-sizing: border-box;
    padding: 2px 4px;
    font-size: 10px;
    text-align: center;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 2px;
    outline: none;
}
.cp-color-canvas {
    cursor: crosshair;
    border-radius: 3px;
    display: block;
}
.cp-color-info {
    font-size: 10px;
    color: var(--vscode-descriptionForeground, #888);
    text-align: center;
    margin-top: 2px;
}
`;
        document.head.appendChild(style);
    }
}

// Singleton
if (typeof window !== 'undefined') {
    window.colorPickerComponent = new ColorPickerComponent();
}
