from __future__ import annotations

from dataclasses import dataclass


"""The public APP copy of the validated v13 pre-cleanup contract.

This module intentionally has no import from ``demo/``.  The production API
must remain runnable when only the public APP tree is shipped.
"""


@dataclass(frozen=True)
class EditPrompt:
    positive: str
    negative: str
    effective_style: str
    source_type: str


COMMON_OUTPUT = """统一输出要求：
- 输出 1:1 正方形高清平滑图，不拉伸主体；需要补边时用最少裁切保住完整内容。
- 这是拼豆网格化之前的视觉预处理，不要生成像素格、马赛克、网格线、圆珠、底板孔、色号或图例。
- 不添加文字、水印、边框、贴纸、装饰或输入图中不存在的内容。"""


AUTO_CLASSIFY_TEMPLATE = """你正在为“照片转拼豆图纸”准备一张适合低分辨率网格化的清晰参考图。输入图片是唯一视觉依据。

先在内部判断图片属于哪一类，只执行一个分支，不要在输出中解释分类过程：

分支 A｜已有卡通、插画、动漫或图形设计
1. 保留整幅原图，不抠出单个角色，不改画风，不重设角色。
2. 严格保留构图、裁切、角色数量、姿势、表情、线稿、配色、文字之外的主要内容和相对位置。
3. 只清理压缩噪点、色带、模糊光晕、锯齿和无意义的近似色，让轮廓更清楚、色块更连续。
4. 适配正方形时优先保住完整内容，可少量裁切或自然补边；不要把角色做成白底贴纸。

分支 B｜风景、建筑、室内、静物、多人场景，或没有可独立抠出的明确主体
1. 保留整幅场景的构图、透视、裁切、空间层次、物体数量、相对位置和主要颜色关系；不要抠图、换背景或虚化背景。
2. 将整幅画面整理为精致、克制的商业插画清稿：轮廓准确，边缘干净，必要处使用细而柔和的同色系描边，禁止粗黑外轮廓。
3. 将照片噪点与琐碎纹理归纳为 2–4 档连贯色面，同时保留空间层次、材质差异和原图光照方向；允许柔和、短促的明暗过渡，禁止廉价扁平化。
4. 不得把建筑、树木等单独抠成白底贴纸，也不得凭空增加人物、动物或装饰。

分支 C｜真实照片，且有清晰、可独立提取的人、动物或物体主体
1. 只提取主体及与主体紧密关联的衣服、配饰、手持物；去掉原场景，放在纯白背景 #FFFFFF 上并居中。
2. 主体在正方形画面中占约 70%–82%，保持完整，四周留出均匀安全边距，不裁断头顶、耳朵、肢体、衣服或道具。
3. 严格保留身份、物种、脸型或外形比例、五官位置、发型、姿势、表情、服装、配饰和关键识别特征。
4. 重绘为适合拼豆降采样的精致商业角色清稿：以准确轮廓和大块连续色面为主，全图控制在约 12–16 个视觉主色；以缩小到 52×52 后仍能辨认主体为最低标准。关键五官和道具标志要适度加粗、拉开明暗，非关键细节直接合并。禁止粗黑线稿、儿童简笔画和大面积纯黑塌缩。
5. 如果环境是内容不可分割的一部分，改用分支 B，不能强行抠主体。

{common_output}

用户补充要求（只在不违反上述保真约束时执行）：{extra}"""


FORCED_SUBJECT_TEMPLATE = """这是一张有明确独立主体的真实照片。执行主体分支，不需要向用户确认主体。
需要保留的主体：{target}

只提取该主体以及紧密关联的衣服、配饰和手持物，去掉原场景，放在纯白背景 #FFFFFF 上并居中。主体在正方形画面中占约 70%–82%，保持完整且不贴边。严格保留身份、物种、脸型或外形比例、五官位置与间距、发际线、发型轮廓、姿势、表情、服装、配饰、遮挡关系和关键识别特征。输入图是唯一依据，不美颜、不幼化、不改变年龄气质，不把真人改成通用网红脸。

将主体重绘为“适合拼豆降采样的商业角色清稿”，而不是精细原画、涂鸦、线稿或像素画：
- 最低可读尺度是 52×52：把整图缩小到 52×52 时，脸型、双眼、眉毛、嘴、发型、双手、衣服轮廓和核心道具仍必须清楚可辨。
- 全图控制在约 12–16 个视觉主色。每种主要材质只保留 2–3 档明确明暗；使用较大、闭合、连续的色面，不使用细碎渐变和密集小色块。
- 造型准确自然，边缘干净。外轮廓使用深棕、深灰或局部同色系，不用纯黑粗线；关键轮廓要有足够宽度，缩小时不能消失。
- 五官不是精细眼妆：删去睫毛碎线、眼影渐变、鼻梁高光点和唇部细纹；保留位置准确、左右协调、面积足够的眼睛、眉毛、鼻部暗示和嘴形色块。
- 头发归纳为一个清楚的主轮廓、一个中间明暗面和最多两组大块高光；删除单根发丝、密集发束线和零碎反光，但不得画成一整块纯黑。
- 衣服只保留决定姿势与结构的主要领口、袖口和 2–4 条大衣褶；删除细密皱纹。白色衣服使用浅暖灰或浅冷灰的大色面与背景区分。
- 双手和手持物保留完整外形、遮挡关系及最关键标志；合并过小装饰，任何非关键细节若缩小后不足约 2 个网格单元宽，应并入邻近主色。
- 不添加网格、方形像素块或拼豆颗粒。输出仍是边缘平滑的高清清稿，但其视觉信息密度必须服从 52×52 制作约束。
- 最终观感应像经过专业图标设计师归纳的角色立绘：保真、柔和、干净，第一眼可辨认，局部没有噪点。

{common_output}

用户补充要求：{extra}"""


PRESERVE_TEMPLATE = """执行完整原图保真预处理，不提取主体，不删除、替换或虚化背景。
严格保留整幅原图的主体、背景、构图、裁切、透视、物体数量、相对位置、主要颜色和光照关系。只提升清晰度，清理压缩噪点、色带、锯齿、模糊边缘和无意义的近似色变化；不要限制为固定的少量颜色，不要改变画风。

{common_output}

用户补充要求：{extra}"""


COMMON_NEGATIVE = (
    "新增或删除主体，改变身份或物种，改变脸型五官、表情、姿势、服装和道具，"
    "错误肢体，多余手指，任意改构图，拉伸，局部照片局部卡通，文字，水印，边框，"
    "像素格，马赛克，网格，坐标，色号，圆形拼豆，塑料珠，底板孔，图例，"
    "粗黑马克笔，粗黑描边，儿童简笔画，幼儿涂鸦，线稿上色，低幼卡通，廉价矢量剪贴画，"
    "大面积纯黑，死黑头发，单根发丝，密集发束线，碎睫毛，眼影渐变，鼻梁高光点，唇部细纹，"
    "密集衣褶，零碎反光，细碎渐变，微小装饰，符号化五官，夸张大眼，尖下巴，网红脸，过度磨皮，塑料质感"
)


def build_v13_edit_prompt(
    *,
    mode: str = "auto",
    style: str = "cartoon",
    subject_presence: str = "unknown",
    subject_target: str = "",
    user_prompt: str = "",
    source_type: str = "auto",
) -> EditPrompt:
    """Build the single v13 AI-cleanup prompt used before quantization."""

    del style
    normalized_mode = mode.strip().lower() or "auto"
    normalized_source = source_type.strip().lower() or "auto"
    if normalized_source not in {"auto", "subject", "scene", "cartoon"}:
        raise ValueError("图片类型只支持 auto、subject、scene 或 cartoon。")

    extra = user_prompt.strip() or "无"
    if normalized_mode == "auto":
        return EditPrompt(
            positive=AUTO_CLASSIFY_TEMPLATE.format(
                common_output=COMMON_OUTPUT,
                extra=extra,
            ),
            negative=COMMON_NEGATIVE,
            effective_style="auto",
            source_type="auto",
        )

    if normalized_mode in {"subject_cartoon", "subject"}:
        if subject_presence not in {"yes", "unknown"}:
            raise ValueError("当前图片没有明确主体，请使用自动生成。")
        target = subject_target.strip() or "画面中最清晰、最主要的独立主体"
        return EditPrompt(
            positive=FORCED_SUBJECT_TEMPLATE.format(
                target=target,
                common_output=COMMON_OUTPUT,
                extra=extra,
            ),
            negative=COMMON_NEGATIVE,
            effective_style="cartoon",
            source_type="subject",
        )

    if normalized_mode in {"whole_image", "scene"}:
        return EditPrompt(
            positive=PRESERVE_TEMPLATE.format(
                common_output=COMMON_OUTPUT,
                extra=extra,
            ),
            negative=COMMON_NEGATIVE,
            effective_style="preserve",
            source_type="cartoon" if normalized_source == "cartoon" else "scene",
        )

    raise ValueError("不支持的处理模式。")


__all__ = ["EditPrompt", "build_v13_edit_prompt"]
