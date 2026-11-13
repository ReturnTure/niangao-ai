"""语音播报的请求模型（独立模块，不依赖 chat 相关模型）。"""

from typing import Optional

from pydantic import BaseModel, Field


class TTSRequest(BaseModel):
    """一段待朗读的文本。前端一般一个句子发一次。"""

    text: str = Field(..., min_length=1, max_length=2000)

    # 音色，见 GET /voice/voices；留空用默认的晓晓
    voice: Optional[str] = None

    # 语速 / 音高预设：warm | calm | slow | cheerful
    preset: Optional[str] = None

    # 直接指定更细的参数时用这两个，优先级高于 preset
    # 格式：rate="+10%" 或 "10"，pitch="+2Hz" 或 "2"
    rate: Optional[str] = None
    pitch: Optional[str] = None


class SplitRequest(BaseModel):
    """把整段回复切成句子，用于前端调试或非流式播报。"""

    text: str = Field(..., min_length=1, max_length=4000)
    max_len: int = Field(default=70, ge=10, le=200)
