export class VTFGlobalsFinder {
    constructor() {
      this.globals = null;
    }
    
    async waitForGlobals(maxRetries = 60, interval = 500) {
      for (let i = 0; i < maxRetries; i++) {
        if (this.findGlobals()) {
          console.log(`[VTF Globals] Found after ${i * interval}ms`);
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
      }
      console.error(`[VTF Globals] Not found after ${maxRetries * interval}ms`);
      return false;
    }
    
    findGlobals() {
      const searchPaths = [
        'window.globals', 'window.appService.globals', 'window.t3.globals'
      ];
      for (const path of searchPaths) {
        const obj = path.split('.').reduce((o, k) => o?.[k], window);
        if (obj && obj.hasOwnProperty('audioVolume')) {
          this.globals = obj;
          return true;
        }
      }
      return false;
    }
  }