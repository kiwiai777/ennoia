// Source Adapter 接口
// 一个 adapter 负责从"某种来源"把原始文本切成一组"文本块"。
// 文本块是未经 extraction 处理的原始字符串，交给下游 extractor 使用。
//
// 命名：canHandle 只做粗判断（不读文件内容），load 真正读取。
// 调用方可以先 canHandle 挑选 adapter，再 load。

export interface SourceAdapter {
  // 是否能处理该路径（文件或目录）。不产生副作用。
  canHandle(path: string): boolean;

  // 读取路径对应的内容，返回一组文本块。
  // - 单文件：通常返回 1 块；如有需要也可切成多块。
  // - 目录：递归内部支持的文件，每个文件贡献若干块。
  load(path: string): Promise<string[]>;
}
