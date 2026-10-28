import logging

import pymysql
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from .config import load_database_settings
from .schemas import ClassifyRequest, ClassifyResponse, ExplainResponse, TreeRequest
from .thresholds import ThresholdRepository
from .tree import Thresholds, classify, explain, level_limits

logger = logging.getLogger("classificador")

DATABASE_ERRORS = (pymysql.MySQLError, OSError)


def create_app(threshold_repository) -> FastAPI:
    app = FastAPI(
        title="Classificador de risco de enchente",
        description="Árvore de decisão (sistema especialista) com os limiares ativos do banco tcc_enchentes.",
    )

    def active_thresholds() -> Thresholds:
        try:
            thresholds = threshold_repository.find_active()
        except DATABASE_ERRORS as error:
            logger.warning("banco indisponível: %s", error)
            raise HTTPException(status_code=503, detail="banco indisponível") from None
        if thresholds is None:
            raise HTTPException(status_code=503, detail="nenhum conjunto de limiares ativo")
        return thresholds

    @app.post("/classify", response_model=ClassifyResponse)
    def classify_reading(request: ClassifyRequest) -> ClassifyResponse:
        thresholds = active_thresholds()
        decision = classify(request.to_tree_input(), thresholds)
        return ClassifyResponse(status=decision.status.name, rule=decision.rule, threshold_set_id=thresholds.id)

    # Only explains: it does not write to the database. The panel uses it for the live tree and the simulator.
    @app.post("/explain", response_model=ExplainResponse)
    def explain_reading(request: TreeRequest) -> ExplainResponse:
        thresholds = active_thresholds()
        explanation = explain(request.to_tree_input(), thresholds)
        limits = level_limits(request.bankfull_depth_mm, thresholds)
        return ExplainResponse.of(explanation, limits, thresholds.id, thresholds.soil_saturated_index)

    @app.get("/health")
    def health():
        try:
            threshold_repository.ping()
        except DATABASE_ERRORS as error:
            return JSONResponse(status_code=503, content={"ok": False, "banco": f"erro: {error}"})
        return {"ok": True, "banco": "ok"}

    return app


def build_app() -> FastAPI:
    return create_app(ThresholdRepository(load_database_settings()))
