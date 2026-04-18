// Source Adapter 接口
//
// 一个 adapter 负责从"某种来源"把原始内容切成一组文本块，并带上来源路径。
// 来源是 user model 追溯与去重的基础，不允许在 adapter 这层 flatten 丢失。

export interface SourceBlock {
  // 文本内容；未经 extraction 处理的原始字符串
  text: string;
  // 该块来自的文件完整路径（绝对或相对均可，由调用方决定）
  source_path: string;
}

export interface SourceAdapter {
  // 是否能处理该路径（文件或目录）。不产生副作用。
  canHandle(path: string): boolean;

  // 读取路径对应的内容，返回一组带来源的文本块。
  // - 单文件：通常返回 1 块，source_path = 该文件路径。
  // - 目录：递归所有支持的文件，每个文件独立一块（或多块），
  //   各自 source_path 指向具体文件，不允许合并。
  load(path: string): Promise<SourceBlock[]>;
}
