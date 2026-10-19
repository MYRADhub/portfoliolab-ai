from fastapi import FastAPI

app = FastAPI(title="PortfolioLab analytics")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
