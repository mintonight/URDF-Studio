# OpenUSD WASM 构建文档

> 最后更新：2026-05-01

## 概述

URDF Studio 使用 WebAssembly 版本的 OpenUSD 来实现 USD 场景解析和渲染。本项目内置了魔改版 OpenUSD 源码和构建脚本，确保所有开发者使用相同的 WASM 运行时。

## 目录结构

```
urdf-studio/
├── third_party/OpenUSD/        # 魔改版 OpenUSD 源码 (270M)
├── scripts/build/
│   ├── rebuild-usd-wasm.sh    # 主编译脚本
│   ├── sync-openusd-source.sh # 源码同步脚本
│   └── README.md             # 使用文档
├── public/patches/            # JS 兼容性补丁
└── public/usd/bindings/      # 编译产物输出目录
```

## 前置条件

需要：Emscripten SDK、Python 3、**CMake ≥ 3.24**、Binaryen（`wasm-opt`）。

安装步骤见 [scripts/build/README.md](../scripts/build/README.md)。

**CMake 版本陷阱**：OpenUSD 声明 3.14+ 即可，但实际需要 3.24+（用了 `LINK_LIBRARY` generator expression）；低于 3.24 会在配置阶段失败，见下文「故障排查」。

## 快速开始

### 标准编译

```bash
# 激活 emscripten 环境
source ~/.localdeps/emsdk/emsdk_env.sh

# 编译（推荐配置）
bash scripts/build/rebuild-usd-wasm.sh \
  --robot-trim \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

### 编译选项详解

| 选项 | 说明 | 推荐值 |
|------|------|--------|
| `--robot-trim` | 修剪非机器人插件，保留核心渲染/物理功能 | ✅ 使用 |
| `--debug` | 构建 debug 版本 | 默认 release |
| `--size-opt` | 优化体积 (-Oz 而非 -O3) | 不推荐 |
| `--no-strip-debug` | 保留调试信息 | 不推荐 |
| `--skip-wasm-opt` | 跳过 wasm-opt 优化 | 不推荐 |
| `--emsdk-env` | 指定 emsdk_env.sh 路径 | 默认自动检测 |
| `--dest-dir` | 指定输出目录 | 默认 `./public/usd/bindings` |

### 环境变量

```bash
JOBS=8                    # 并行编译任务数（默认自动检测）
EMSCRIPTEN_OPT_LEVEL=-O3  # C/C++ 编译优化级别
EMSCRIPTEN_ENABLE_SIMD=1  # 启用 WASM SIMD
WASM_OPT_LEVEL=-O3        # wasm-opt 优化级别
```

## 编译产物

编译完成后，以下文件会被复制到 `public/usd/bindings/`：

| 文件 | 说明 | 大小 |
|------|------|------|
| `emHdBindings.js` | WASM 模块加载器和 JS 接口 | ~200KB |
| `emHdBindings.wasm` | 编译后的 OpenUSD C++ 代码 | ~18MB |
| `emHdBindings.worker.js` | Web Worker 线程支持 | ~3KB |
| `emHdBindings.data` | 预加载的数据文件 | ~850KB |

## OpenUSD 魔改说明

本项目使用的 OpenUSD 包含以下自定义修改：

1. **Emscripten 兼容性补丁**
   - WebAssembly 环境适配
   - 文件系统 API 修改

2. **构建配置调整**
   - 针对浏览器环境的优化
   - 机器人模型相关的性能改进

3. **补丁文件** (`public/patches/`)
   - `abort.patch`: 放宽 abort 行为，允许单个资源失败后继续加载
   - `arguments_*.patch`: 参数传递兼容性修复
   - `fileSystem.patch`: 文件系统 API 适配

## 故障排查

### CMake 配置失败：`Error evaluating generator expression`

```
Error evaluating generator expression:
    $<LINK_LIBRARY:LOAD_PLUGIN,hdStorm_internal>

  Expression did not evaluate to a known generator expression
```

**原因**：CMake 版本太老，OpenUSD 需要 3.24+。升级 CMake（步骤见 `scripts/build/README.md`）。

### 前置条件未生效（emcc / wasm-opt 缺失、找不到 OpenUSD 脚本）

按顺序检查：
1. `source ~/.localdeps/emsdk/emsdk_env.sh` 是否已执行 → `emcc --version`
2. `wasm-opt --version` → 缺失时 `apt install binaryen` / `brew install binaryen`
3. `ls third_party/OpenUSD/build_scripts/build_usd.py` 确认源码路径

### 编译时间过长

- 首次编译可能需要 30-60 分钟
- 增量编译会快很多
- 可以增加 `JOBS` 参数提高并行度

## 相关文档

- [viewer.md](viewer.md) - USD runtime 使用说明
- [scripts/build/README.md](../scripts/build/README.md) - 脚本详细文档

## 许可证

OpenUSD 使用 Modified Apache 2.0 License，详见 `third_party/OpenUSD/LICENSE.txt`。
