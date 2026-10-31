// Copy the complete object below into MagicMirror's config.modules array.
// Enter credentials ONLY in ~/MagicMirror/config/config.js on each Pi.
({
  module: "MMM-KiaAccess",
  position: "bottom_center",
  header: "Bluebell",
  config: {
    username: "YOUR_KIA_EMAIL",
    password: "YOUR_KIA_PASSWORD",
    pin: "",
    brand: "KIA",
    region: "USA",
    // Requests cloud-cached data; does not request a forced vehicle refresh.
    refresh: false,
    forceRefreshTimeout: 0,
    updateInterval: 1800000,
    units: "imperial",
    maxWidth: "320px",
    showTable: false,
    include: [
      "vehicle.ev_battery_percentage",
      "vehicle.ev_driving_range",
      "vehicle.ev_battery_is_charging",
      "vehicle.ev_battery_is_plugged_in",
      "vehicle.car_battery_percentage",
      "vehicle.is_locked",
      "vehicle.last_updated_at"
    ],
    labels: {
      "vehicle.ev_driving_range": "Driving Range",
      "vehicle.car_battery_percentage": "12V Battery"
    },
    formatters: {
      "vehicle.ev_driving_range": "distanceKm",
      "vehicle.car_battery_percentage": "percent"
    },
    showHeaderCount: false,
    showUpdatedFooter: false,
    showReportedInHeader: true,
    notifications: { checks: { serviceDue: false } },
    visuals: {
      enabled: true,
      compact: false,
      car: true,
      battery: true,
      width: 190,
      batteryDetail: ["vehicle.ev_driving_range", "vehicle.car_battery_percentage"],
      rangeRing: false,
      chargeProgress: false,
      location: { enabled: false, map: false }
    }
  }
});
