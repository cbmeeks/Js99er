/*
 * js99'er - TI-99/4A emulator written in JavaScript
 *
 * Created 2014 by Rasmus Moustgaard <rasmus.moustgaard@gmail.com>
*/

 'use strict';

TI994A.FRAMES_TO_RUN = Number.MAX_VALUE;
TI994A.FRAME_MS = 16.66;
TI994A.FPS_MS = 4000;

function TI994A(canvas, diskImages, settings, onBreakpoint) {
    this.canvas = canvas;
    this.onBreakpoint = onBreakpoint;

    // Assemble the console
    this.keyboard = new Keyboard(settings && settings.isPCKeyboardEnabled());
    this.cru = new CRU(this.keyboard);
    this.tms9919 = new TMS9919();
    this.setVDP(settings);
    var vdpRAM = this.vdp.getRAM();
    this.diskDrives = [
        new DiskDrive("DSK1", vdpRAM, diskImages ? diskImages.FLOPPY1 : null),
        new DiskDrive("DSK2", vdpRAM, diskImages ? diskImages.FLOPPY2 : null),
        new DiskDrive("DSK3", vdpRAM, diskImages ? diskImages.FLOPPY3 : null)
    ];
    this.setGoogleDrive(settings);
    this.tms5220 = new TMS5220(settings.isSpeechEnabled());
    this.memory = new Memory(this.vdp, this.tms9919, this.tms5220, settings);
    this.tms9900 = new TMS9900(this.memory, this.cru, this.keyboard, this.diskDrives, this.googleDrives);
    this.cru.setMemory(this.memory);
    this.tms5220.setTMS9900(this.tms9900);

    this.cpuSpeed = 1;
    this.frameCount = 0;
    this.lastFpsTime = null;
    this.fpsFrameCount = 0;
    this.running = false;
    this.cpuFlag = true;
    this.log = Log.getLog();

    this.reset();
}

TI994A.prototype = {

    setVDP: function(settings) {
        if (settings && settings.isF18AEnabled()) {
            this.vdp = new F18A(this.canvas, this.cru, this.tms9919);
        }
        else {
            this.vdp = new TMS9918A(this.canvas, this.cru, settings.isFlickerEnabled());
        }
        if (this.memory) {
            this.memory.vdp = this.vdp;
        }
        if (this.diskDrives) {
            for (var i = 0; i < this.diskDrives.length; i++) {
                this.diskDrives[i].setRAM(this.vdp.getRAM());
            }
        }
        if (settings && settings.isGoogleDriveEnabled() && this.googleDrives) {
            for (var j = 0; j < this.googleDrives.length; j++) {
                this.googleDrives[j].setRAM(this.vdp.getRAM());
            }
        }
    },

    setGoogleDrive: function(settings) {
        if (settings && settings.isGoogleDriveEnabled()) {
            var vdpRAM = this.vdp.getRAM();
            this.googleDrives = [
                new GoogleDrive("GDR1", vdpRAM, "Js99erDrives/GDR1"),
                new GoogleDrive("GDR2", vdpRAM, "Js99erDrives/GDR2"),
                new GoogleDrive("GDR3", vdpRAM, "Js99erDrives/GDR3")
            ];
        }
        else {
            this.googleDrives = [];
        }
    },

    isRunning: function() {
        return this.running;
    },

    reset: function(keepCart) {
        this.vdp.reset();
        this.tms9919.reset();
        this.tms5220.reset();
        this.keyboard.reset();
        this.memory.reset(keepCart);
        this.cru.reset();
        this.tms9900.reset();
        this.resetFps();
        this.cpuSpeed = 1;
    },

    start: function(fast) {
        if (!this.isRunning()) {
            this.cpuSpeed = fast ? 2 : 1;
            this.log.info("Start");
            this.tms9900.setSuspended(false);
            var self = this;
            this.frameInterval = setInterval(
                function() {
                    if (self.frameCount < TI994A.FRAMES_TO_RUN) {
                        self.frame();
                    }
                    else {
                        self.stop();
                    }
                },
                TI994A.FRAME_MS
            );
            this.resetFps();
            this.printFps();
            this.fpsInterval = setInterval(
                function() {
                    self.printFps();
                },
                TI994A.FPS_MS
            );
        }
        this.running = true;
    },

    frame: function() {
        var cpuSpeed = this.cpuSpeed;
        if (this.vdp.gpu && !this.vdp.gpu.isIdle()) {
            this.vdp.gpu.run(F18AGPU.FRAME_CYCLES * cpuSpeed);
            if (this.vdp.gpu.atBreakpoint()) {
                if (this.onBreakpoint) {
                    this.onBreakpoint(this.vdp.gpu);
                }
            }
            cpuSpeed *= 0.5; // Reduce CPU cycles when GPU is running
        }
        if (!this.tms9900.isSuspended()) {
            this.tms9900.run(TMS9900.FRAME_CYCLES * cpuSpeed);
            if (this.tms9900.atBreakpoint()) {
                if (this.onBreakpoint) {
                    this.onBreakpoint(this.tms9900);
                }
            }
        }
        this.drawFrame();
        this.cru.decrementCounter(781);
        this.frameCount++;
    },

    step: function() {
        if (this.vdp.gpu && !this.vdp.gpu.isIdle()) {
            this.vdp.gpu.run(1);
        }
        else {
            this.tms9900.run(1);
        }
        this.drawFrame();
    },

    stop: function() {
        this.log.info("Stop");
        clearInterval(this.frameInterval);
        clearInterval(this.fpsInterval);
        this.tms9919.mute();
        this.running = false;
    },

    drawFrame: function() {
        if (false && window.requestAnimationFrame) {
            var that = this;
            requestAnimationFrame(function (timestamp) {
                that.vdp.drawFrame(timestamp);
                that.fpsFrameCount++;
            });
        }
        else {
            this.vdp.drawFrame(window.performance ? window.performance.now() : new Date().getTime());
            this.fpsFrameCount++;
        }
    },

    resetFps: function() {
        this.lastFpsTime = null;
        this.fpsFrameCount = 0;
    },

    printFps: function() {
        var now = +new Date();
        var s = 'Frame ' + this.frameCount + ' running';
        if (this.lastFpsTime) {
            s += ': '
                + (this.fpsFrameCount / ((now - this.lastFpsTime) / 1000)).toFixed(1)
                + ' / '
                + (1000 / TI994A.FRAME_MS).toFixed(1)
                + ' FPS';
        }
        this.log.info(s);
        this.fpsFrameCount = 0;
        this.lastFpsTime = now;
    },

    getPC: function() {
        if (this.vdp.gpu && !this.vdp.gpu.isIdle()) {
            return this.vdp.gpu.getPC();
        }
        else {
            return this.tms9900.getPC();
        }
    },

    getStatusString: function() {
        return (
            this.vdp.gpu && !this.vdp.gpu.isIdle() ?
                this.vdp.gpu.getInternalRegsString() + " F18A GPU\n" + this.vdp.gpu.getRegsStringFormatted() :
                this.tms9900.getInternalRegsString() + "\n" + this.tms9900.getRegsStringFormatted()
        ) + this.vdp.getRegsString() + "\n" + this.memory.getStatusString();
    },

    getDiskDrives: function() {
        return this.diskDrives;
    },

    loadSoftware: function(sw) {
        var wasRunning = this.isRunning();
        if (wasRunning) {
            this.stop();
        }
        this.reset(sw.memoryBlocks != null);
        if (sw.memoryBlocks != null) {
            for (var i = 0; i < sw.memoryBlocks.length; i++) {
                var memoryBlock = sw.memoryBlocks[i];
                this.memory.loadRAM(memoryBlock.address, memoryBlock.data);
            }
        }
        if (sw.rom != null) {
            this.memory.setCartridgeImage(sw.rom, sw.type == Software.TYPE_INVERTED_CART);
        }
        if (sw.grom != null) {
            this.memory.loadGROM(sw.grom, 3, 0);
        }
        if (sw.groms != null) {
            for (var g = 0; g < sw.groms.length; g++) {
                this.memory.loadGROM(sw.groms[g], 3, g);
            }
        }
        this.memory.toggleCartridgeRAM(0x6000, 0x1000, sw.ramAt6000);
        this.memory.toggleCartridgeRAM(0x7000, 0x1000, sw.ramAt7000);
        this.tms9900.setWP(sw.workspaceAddress != null ? sw.workspaceAddress : (SYSTEM.ROM[0] << 8 | SYSTEM.ROM[1]));
        this.tms9900.setPC(sw.startAddress != null ? sw.startAddress : (SYSTEM.ROM[2] << 8 | SYSTEM.ROM[3]));
        if (wasRunning) {
            this.start();
        }
        if (sw.keyPresses) {
            var that = this;
            window.setTimeout(
                function() {
                    that.keyboard.simulateKeyPresses(sw.keyPresses);
                },
                1000
            );
        }
    }
};
