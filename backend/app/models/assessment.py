from pydantic import BaseModel
from typing import List


class AssessmentSubmit(BaseModel):
    """提交一次 PHQ-9 作答。答案的具体校验在路由里交给 service 完成，
    这样报错文案能保持中文且只维护一处。"""

    answers: List[int]
