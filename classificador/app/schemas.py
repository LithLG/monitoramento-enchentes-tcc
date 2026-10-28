import math

from pydantic import BaseModel, Field, field_validator, model_validator

from .tree import Decision, Explanation, LevelLimits, LevelRange, RainClass, Status, TreeInput


class TreeRequest(BaseModel):
    level_range: LevelRange
    level_depth_mm: float | None = Field(default=None, ge=0)
    bankfull_depth_mm: float = Field(gt=0)
    rain_class: RainClass
    soil_index: float
    previous_status: Status | None = None

    @field_validator("previous_status", mode="before")
    @classmethod
    def status_from_name(cls, value):
        if value is None or isinstance(value, Status):
            return value
        try:
            return Status[value]
        except KeyError:
            raise ValueError(f"previous_status desconhecido: {value}") from None

    @field_validator("soil_index")
    @classmethod
    def soil_index_is_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("soil_index deve ser um número finito")
        return value

    @model_validator(mode="after")
    def depth_matches_level_range(self):
        is_inside = self.level_range is LevelRange.INSIDE
        has_depth = self.level_depth_mm is not None
        if is_inside != has_depth:
            raise ValueError("level_depth_mm é obrigatório com DENTRO e deve ser nulo com ABAIXO ou ACIMA")
        return self

    def to_tree_input(self) -> TreeInput:
        return TreeInput(
            level_range=self.level_range,
            level_depth_mm=self.level_depth_mm,
            bankfull_depth_mm=self.bankfull_depth_mm,
            rain_class=self.rain_class,
            soil_index=self.soil_index,
            previous_status=self.previous_status,
        )


class ClassifyRequest(TreeRequest):
    reading_id: int = Field(ge=1)
    node_id: int = Field(ge=1)


class ClassifyResponse(BaseModel):
    status: str
    rule: str = Field(max_length=40)
    threshold_set_id: int


class DecisionOut(BaseModel):
    status: str
    rule: str

    @classmethod
    def of(cls, decision: Decision) -> "DecisionOut":
        return cls(status=decision.status.name, rule=decision.rule)


class LimitsOut(BaseModel):
    dry_mm: float
    attention_mm: float
    attention_exit_mm: float
    risk_mm: float
    risk_exit_mm: float
    bankfull_mm: float


class ExplainResponse(BaseModel):
    threshold_set_id: int
    by_level: DecisionOut
    previous_was_higher: bool
    after_hysteresis: DecisionOut
    is_raining: bool
    soil_is_saturated: bool
    soil_saturated_index: float
    final: DecisionOut
    limits: LimitsOut

    @classmethod
    def of(cls, explanation: Explanation, limits: LevelLimits, threshold_set_id: int, soil_saturated_index: float):
        return cls(
            threshold_set_id=threshold_set_id,
            by_level=DecisionOut.of(explanation.by_level),
            previous_was_higher=explanation.previous_was_higher,
            after_hysteresis=DecisionOut.of(explanation.after_hysteresis),
            is_raining=explanation.is_raining,
            soil_is_saturated=explanation.soil_is_saturated,
            soil_saturated_index=soil_saturated_index,
            final=DecisionOut.of(explanation.final),
            limits=LimitsOut(**vars(limits)),
        )
