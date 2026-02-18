/**
 * ColorPickerComponent
 * Custom HSL color picker popup replacing native <input type="color">.
 * Internal model uses HSV (maps to gradient area). Display defaults to HSL.
 */

class ColorPickerComponent {
    constructor() {
        this._popup = null;
        this._trigger = null;
        this._onChange = null;
        this._mode = 'hsl'; // hsl | rgb | hex
        // Internal HSV state
        this._hue = 0;       // 0-360
        this._sat = 100;     // 0-100 (HSV saturation)
        this._val = 100;     // 0-100 (HSV value)
        this._dragging = null; // 'gradient' | 'hue' | null
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
        this._mode = 'hsl';
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

        // Flexoki palette data (shades 50-950 per color family)
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
        let paletteHtml = '<div class="cp-palette">';
        for (const row of flexoki) {
            const hsl = window.colorUtils.hexToHsl(row.ref);
            const whitish = hsl ? window.colorUtils.hslToHex(hsl.h, hsl.s, 98) : '#FAFAFA';
            const blackish = hsl ? window.colorUtils.hslToHex(hsl.h, hsl.s, 2) : '#050505';
            const allColors = [whitish, ...row.shades, blackish];
            for (const color of allColors) {
                paletteHtml += '<div class="cp-swatch" data-color="' + color + '" style="background:' + color + '" title="' + color + '"></div>';
            }
        }
        paletteHtml += '</div>';

        popup.innerHTML = paletteHtml + `
            <canvas class="cp-gradient" width="160" height="88"></canvas>
            <canvas class="cp-hue-bar" width="160" height="10"></canvas>
            <div class="cp-controls">
                <div class="cp-preview"></div>
                <div class="cp-inputs"></div>
                <button class="cp-mode-btn">HSL</button>
            </div>
        `;

        document.body.appendChild(popup);
        this._popup = popup;

        // Canvas refs
        this._gradientCanvas = popup.querySelector('.cp-gradient');
        this._hueCanvas = popup.querySelector('.cp-hue-bar');
        this._preview = popup.querySelector('.cp-preview');
        this._inputsContainer = popup.querySelector('.cp-inputs');
        this._modeBtn = popup.querySelector('.cp-mode-btn');

        // Event bindings
        this._gradientCanvas.addEventListener('mousedown', (e) => this._startDrag('gradient', e));
        this._hueCanvas.addEventListener('mousedown', (e) => this._startDrag('hue', e));
        this._modeBtn.addEventListener('click', () => this._cycleMode());

        // Palette swatch click handlers
        popup.querySelectorAll('.cp-swatch').forEach(swatch => {
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
    }

    _positionPopup() {
        if (!this._trigger || !this._popup) return;
        const rect = this._trigger.getBoundingClientRect();
        // Fixed popup width: 160 canvas + 6*2 padding + 1*2 border = 174
        const pw = 174, ph = this._popup.offsetHeight;
        let top = rect.bottom + 4;
        let left = Math.max(4, (window.innerWidth - pw) / 2);
        if (top + ph > window.innerHeight) top = Math.max(4, rect.top - ph - 4);
        this._popup.style.top = top + 'px';
        this._popup.style.left = left + 'px';
    }

    // ============= Rendering =============

    _renderAll() {
        this._renderGradient();
        this._renderHueBar();
        this._renderPreview();
        this._renderInputs();
    }

    _renderGradient() {
        const canvas = this._gradientCanvas;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        // Base hue color
        const hueRgb = window.colorUtils.hsvToRgb(this._hue, 100, 100);
        const hueStr = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
        // Fill with hue
        ctx.fillStyle = hueStr;
        ctx.fillRect(0, 0, w, h);
        // White gradient left to right
        const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
        whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
        whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(0, 0, w, h);
        // Black gradient top to bottom
        const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, w, h);
        // Cursor
        const cx = (this._sat / 100) * w;
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
    }

    _renderHueBar() {
        const canvas = this._hueCanvas;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i <= 6; i++) {
            const rgb = window.colorUtils.hsvToRgb((i / 6) * 360, 100, 100);
            grad.addColorStop(i / 6, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        // Cursor
        const cx = (this._hue / 360) * w;
        ctx.beginPath();
        ctx.rect(cx - 3, 0, 6, h);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.rect(cx - 2, 0, 4, h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    _renderPreview() {
        const hex = this._currentHex();
        this._preview.style.backgroundColor = hex;
    }

    _renderInputs() {
        const container = this._inputsContainer;
        this._modeBtn.textContent = this._mode.toUpperCase();
        let html = '';
        if (this._mode === 'hsl') {
            const hsl = this._currentHsl();
            html += this._numInput('H', hsl.h, 0, 360);
            html += this._numInput('S', hsl.s, 0, 100);
            html += this._numInput('L', hsl.l, 0, 100);
        } else if (this._mode === 'rgb') {
            const rgb = this._currentRgb();
            html += this._numInput('R', rgb.r, 0, 255);
            html += this._numInput('G', rgb.g, 0, 255);
            html += this._numInput('B', rgb.b, 0, 255);
        } else {
            html += '<label class="cp-field"><span>Hex</span><input type="text" class="cp-hex-input" value="' + this._currentHex() + '" maxlength="7"></label>';
        }
        container.innerHTML = html;
        // Attach input listeners
        container.querySelectorAll('.cp-num-input').forEach(inp => {
            inp.addEventListener('change', () => this._onTextInput());
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._onTextInput(); });
        });
        const hexInp = container.querySelector('.cp-hex-input');
        if (hexInp) {
            hexInp.addEventListener('change', () => this._onHexInput(hexInp.value));
            hexInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._onHexInput(hexInp.value); });
        }
    }

    _numInput(label, value, min, max) {
        return `<label class="cp-field"><span>${label}</span><input type="number" class="cp-num-input" data-channel="${label}" min="${min}" max="${max}" value="${value}"></label>`;
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
        // At L=100 (white) or L=0 (black), saturation is irrelevant — show 100
        if (hsl.l === 100 || hsl.l === 0) hsl.s = 100;
        return hsl;
    }

    // ============= Drag Interaction =============

    _startDrag(target, e) {
        e.preventDefault();
        this._dragging = target;
        this._applyDrag(e);
        document.addEventListener('mousemove', this._boundOnMouseMove, true);
        document.addEventListener('mouseup', this._boundOnMouseUp, true);
    }

    _onMouseMove(e) {
        if (this._dragging) this._applyDrag(e);
    }

    _onMouseUp() {
        this._dragging = null;
        document.removeEventListener('mousemove', this._boundOnMouseMove, true);
        document.removeEventListener('mouseup', this._boundOnMouseUp, true);
    }

    _applyDrag(e) {
        if (this._dragging === 'gradient') {
            const rect = this._gradientCanvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            this._sat = Math.round(x * 100);
            this._val = Math.round((1 - y) * 100);
            this._renderGradient();
            this._renderPreview();
            this._renderInputs();
            this._emitChange();
        } else if (this._dragging === 'hue') {
            const rect = this._hueCanvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this._hue = Math.round(x * 360);
            if (this._hue >= 360) this._hue = 359;
            this._renderGradient();
            this._renderHueBar();
            this._renderPreview();
            this._renderInputs();
            this._emitChange();
        }
    }

    // ============= Text Input Handling =============

    _onTextInput() {
        const inputs = this._inputsContainer.querySelectorAll('.cp-num-input');
        const vals = {};
        inputs.forEach(inp => {
            vals[inp.dataset.channel] = parseInt(inp.value, 10) || 0;
        });
        if (this._mode === 'hsl') {
            const h = Math.max(0, Math.min(360, vals.H || 0));
            const s = Math.max(0, Math.min(100, vals.S || 0));
            const l = Math.max(0, Math.min(100, vals.L || 0));
            const rgb = window.colorUtils.hslToRgb(h, s, l);
            const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
            this._hue = hsv.h;
            this._sat = hsv.s;
            this._val = hsv.v;
        } else if (this._mode === 'rgb') {
            const r = Math.max(0, Math.min(255, vals.R || 0));
            const g = Math.max(0, Math.min(255, vals.G || 0));
            const b = Math.max(0, Math.min(255, vals.B || 0));
            const hsv = window.colorUtils.rgbToHsv(r, g, b);
            this._hue = hsv.h;
            this._sat = hsv.s;
            this._val = hsv.v;
        }
        this._renderGradient();
        this._renderHueBar();
        this._renderPreview();
        this._emitChange();
    }

    _onHexInput(hex) {
        if (!hex.startsWith('#')) hex = '#' + hex;
        const rgb = window.colorUtils.hexToRgb(hex);
        if (!rgb) return;
        const hsv = window.colorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
        this._hue = hsv.h;
        this._sat = hsv.s;
        this._val = hsv.v;
        this._renderGradient();
        this._renderHueBar();
        this._renderPreview();
        this._emitChange();
    }

    // ============= Mode Cycling =============

    _cycleMode() {
        const modes = ['hsl', 'rgb', 'hex'];
        const idx = modes.indexOf(this._mode);
        this._mode = modes[(idx + 1) % modes.length];
        this._renderInputs();
    }

    // ============= Events =============

    _emitChange() {
        if (this._onChange) this._onChange(this._currentHex());
    }

    _onKeyDown(e) {
        if (e.key === 'Escape') {
            this.close();
        }
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
.cp-gradient {
    cursor: crosshair;
    border-radius: 2px;
    display: block;
}
.cp-hue-bar {
    cursor: crosshair;
    border-radius: 2px;
    display: block;
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
.cp-inputs {
    display: flex;
    gap: 2px;
}
.cp-field {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.cp-field span {
    font-size: 9px;
    color: var(--vscode-descriptionForeground, #888);
    margin-bottom: 1px;
}
.cp-num-input {
    width: 30px;
    box-sizing: border-box;
    padding: 2px 2px;
    font-size: 10px;
    text-align: center;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 2px;
    outline: none;
    -moz-appearance: textfield;
}
.cp-num-input::-webkit-outer-spin-button,
.cp-num-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.cp-hex-input {
    width: 94px;
    box-sizing: border-box;
    padding: 2px 2px;
    font-size: 10px;
    text-align: center;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 2px;
    outline: none;
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
`;
        document.head.appendChild(style);
    }
}

// Singleton
if (typeof window !== 'undefined') {
    window.colorPickerComponent = new ColorPickerComponent();
}
