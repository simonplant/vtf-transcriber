export class VTFStreamMonitor {
    constructor() {
      this.monitors = new Map();
    }
    
    startMonitoring(element, userId, callback) {
      if (element.srcObject) {
        callback(element.srcObject);
        return;
      }
      
      const monitor = {
        pollInterval: setInterval(() => {
          if (element.srcObject) {
            clearInterval(monitor.pollInterval);
            this.monitors.delete(userId);
            callback(element.srcObject);
          } else if (++monitor.pollCount >= 100) { // 5-second timeout
            clearInterval(monitor.pollInterval);
            this.monitors.delete(userId);
          }
        }, 50),
        pollCount: 0
      };
      this.monitors.set(userId, monitor);
    }
  }