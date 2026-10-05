from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EditPrompt:
    positive: str
    negative: str
    effective_style: str
    source_type: str


PIXEL_SUBJECT_PENDANT_TEMPLATE = """把“{target}”重绘为中颗粒 Q 版像素角色，仅依据原图；把半身照补成全身照。

保留核心识别锚点：姿势、主色；允许做简约像素化二创和适度调整头身比例（大头短腿），但不要改变核心姿势、已出现的服装或取景范围；不换色、不加配饰。内容和全部颜色以原图为准。

脸部主动简化为参考图式 Q 版：只用少量大色块表示脸型、眉眼方向和嘴部表情；眼睛要大或者是笑起来的线条眯眯眼；鼻子只保留一个简单暗示，删除细小五官刻画。

去背景，纯白底居中。6–10 个主色，大色块连续；肤色不漂白/灰化/橙化；黑/深灰仅限原图已有的头发和轮廓，不扩散到皮肤或衣服。服装与道具颜色严格沿用原图，只可合并近色、简化明暗（白衣保持白/浅灰，青绿不变黑灰或橙）。

像素风格：中大方块、自然阶梯轮廓，8-bit 马赛克风格。

主体优先：主体须完整实心、边缘闭合可抠图；脸/衣服/手/道具禁止镂空，白底不可侵入主体，浅色区域用浅灰区分于白底。

去除原图杂质：去除阴影、光晕、半透明毛边、边缘杂色、网格、拼豆颗粒、色号、文字、水印。

轮廓优先：主体外轮廓必须连续、闭合、阶梯状；与白底接触的白色/浅色衣服和配饰，必须用连续的浅灰或冷灰同色系外缘区分，约 1–2 个网格单元宽，不用粗黑边，也不能与白底连成一片。主体四周保留至少 5% 纯白安全边距，衣物不能触碰画布边缘或延伸出画面。

用户补充要求：{extra}"""


PIXEL_SUBJECT_FLAT_TEMPLATE = """把“{target}”重绘为中颗粒 Q 版像素角色，严格保持原图取景范围，保持为半身照片。

保留核心识别锚点：姿势、主色；允许做简约像素化二创和适度调整头身比例（大头），但不要改变核心姿势、已出现的服装或取景范围；不换色、不加配饰。内容和全部颜色以原图为准。

脸部主动简化为参考图式 Q 版：只用少量大色块表示脸型、眉眼方向和嘴部表情；眼睛要大或者是笑起来的线条眯眯眼；鼻子只保留一个简单暗示，删除细小五官刻画。

去背景，纯白底居中。6–10 个主色，大色块连续；肤色不漂白/灰化/橙化；黑/深灰仅限原图已有的头发和轮廓，不扩散到皮肤或衣服。服装与道具颜色严格沿用原图，只可合并近色、简化明暗（白衣保持白/浅灰，青绿不变黑灰或橙）。

像素风格：中大方块、自然阶梯轮廓，8-bit 马赛克风格。

主体优先：主体须完整实心、边缘闭合可抠图；脸/衣服/手/道具禁止镂空，白底不可侵入主体，浅色区域用浅灰区分于白底。

去除原图杂质：去除阴影、光晕、半透明毛边、边缘杂色、网格、拼豆颗粒、色号、文字、水印。

轮廓优先：主体外轮廓必须连续、闭合、阶梯状；与白底接触的白色/浅色衣服和配饰，必须用连续的浅灰或冷灰同色系外缘区分，约 1–2 个网格单元宽，不用粗黑边，也不能与白底连成一片。主体四周保留至少 5% 纯白安全边距，衣物不能触碰画布边缘或延伸出画面。

用户补充要求：{extra}"""


PIXEL_NEGATIVE = (
    "改变身份/物种，丢失发型、脸部特征或关键道具，复制参考图的人物/配色/服装/道具/姿势，新增人物/背景/配饰，补全全身/延展被裁切身体/四肢/衣服（含原图无眼镜却出现镜框），"
    "肤色漂白/灰脏/橙化，黑色扩散到皮肤或衣服，服装或道具颜色改变（白衣变深、青绿变黑/橙、黑发变棕），"
    "复杂服装/细发丝/复杂手指/密集小装饰，照片感，平滑矢量，模糊，巨型 8-bit 方块，密集小像素，网格线，"
    "断裂/开放边界，主体镂空，白底侵入主体，阴影，光晕，半透明毛边，边缘杂色，拼豆，色号，文字，水印"
)


def build_xhs_edit_prompt(
    *,
    mode: str = "subject_cartoon",
    style: str = "cartoon",
    subject_presence: str = "unknown",
    subject_target: str = "",
    user_prompt: str = "",
    source_type: str = "subject",
    framing_mode: str = "flat",
) -> EditPrompt:
    """Build the selected flat or pendant subject-redraw prompt."""

    del style, source_type
    normalized_mode = mode.strip().lower()

    extra = user_prompt.strip() or "无"
    normalized_framing = framing_mode.strip().lower() or "flat"
    if normalized_framing not in {"flat", "pendant"}:
        raise ValueError("主体取景模式只支持 flat 或 pendant。")
    if normalized_mode == "subject_cartoon":
        if subject_presence not in {"yes", "unknown"}:
            raise ValueError("当前模式需要明确的主体。")
        target = subject_target.strip() or "画面中最清晰、最主要的独立主体"
        subject_template = (
            PIXEL_SUBJECT_PENDANT_TEMPLATE
            if normalized_framing == "pendant"
            else PIXEL_SUBJECT_FLAT_TEMPLATE
        )
        negative = PIXEL_NEGATIVE
        if normalized_framing == "pendant":
            negative = negative.replace(
                "，补全全身/延展被裁切身体/四肢/衣服（含原图无眼镜却出现镜框）",
                "（含原图无眼镜却出现镜框）",
            )
        return EditPrompt(
            positive=subject_template.format(
                target=target,
                extra=extra,
            ),
            negative=negative,
            effective_style="pixel",
            source_type="subject",
        )

    raise ValueError("不支持的处理模式。")
