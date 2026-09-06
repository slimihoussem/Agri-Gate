type HealthResponse = {
  status: (code: number) => HealthResponse;
  json: (body: unknown) => void;
};

export default function health(_request: unknown, response: HealthResponse): void {
  response.status(200).json({
    status: "ok",
    service: "agrigate-api",
    time: new Date().toISOString(),
  });
}
