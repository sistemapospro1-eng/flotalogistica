class LocationProvider {
  constructor() {
    this.enabled = false;
  }

  async getCurrentPosition() {
    return null;
  }

  async trackVehicle() {
    return null;
  }
}

window.LocationProvider = LocationProvider;
