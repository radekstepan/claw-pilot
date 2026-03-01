export class GatewayOfflineError extends Error {
  override readonly name = "GatewayOfflineError";
  constructor(method: string, cause: Error) {
    super(`Gateway unreachable (${method}): ${cause.message}`);
    this.cause = cause;
  }
}

export class GatewayPairingRequiredError extends Error {
  override readonly name = "GatewayPairingRequiredError";
  readonly deviceId: string;
  constructor(deviceId: string) {
    super(
      `Gateway pairing required for device ${deviceId}. Run: openclaw devices approve --latest`,
    );
    this.deviceId = deviceId;
  }
}
