from fastapi import APIRouter, Depends

from lvda import evaluation
from lvda.security import Member, engineer

router = APIRouter(prefix="/api/db/{db_id}/eval", tags=["eval"])


@router.get("")
def latest(db_id: int, m: Member = Depends(engineer)):
    return evaluation.latest(db_id)


@router.post("/verifier")
def run_verifier(db_id: int, m: Member = Depends(engineer)):
    return evaluation.run_verifier_eval(db_id, m.user.id)


@router.post("/agent")
def run_agent(db_id: int, m: Member = Depends(engineer)):
    return evaluation.run_agent_eval(db_id, m.user.id)
