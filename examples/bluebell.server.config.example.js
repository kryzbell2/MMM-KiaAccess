// Copy the complete object below into MagicMirror's config.modules array.
// Credentials belong only in the private server profile outside MagicMirror.
({
  module: "MMM-KiaAccess",
  position: "bottom_center",
  header: "Bluebell",
  config: {
    credentialProfile: "bluebell",
    brand: "KIA",
    region: "USA",
    adaptivePolling: {
      enabled: false,
      chargingInterval: 600000,
      pluggedInterval: 1800000,
      idleInterval: 3600000,
      staleInterval: 3600000,
      statusMaxAge: 1200000,
      liveRefreshTimeout: 30,
      maxLiveRequestsPerHour: 6,
      maxContinuousActiveMinutes: 90
    },
    // Legacy settings apply if adaptive polling is disabled.
    refresh: false,
    forceRefreshTimeout: 0,
    updateInterval: 1800000,
    maxRequestsPerHour: 12,
    maxCloudRequestsPerHour: 60,
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
