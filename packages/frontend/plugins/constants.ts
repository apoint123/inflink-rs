import path from "node:path";
import type { HijackAction } from "@/types/manifest";

/** 前端包根目录 (`packages/frontend`) */
export const FRONTEND_DIR = path.resolve(import.meta.dirname, "..");

/** 项目仓库根目录 */
export const PROJECT_ROOT = path.resolve(FRONTEND_DIR, "../..");

/** 前端源码目录 (`src`) */
export const SRC_DIR = path.join(FRONTEND_DIR, "src");

/** 生产构建产物输出目录 (`dist`) */
export const DIST_DIR = path.join(FRONTEND_DIR, "dist");

/** 插件 manifest.json 源码路径 */
export const MANIFEST_SRC = path.join(FRONTEND_DIR, "manifest.json");

/** 默认 BetterNCM 插件安装目录 */
export const DEFAULT_PLUGIN_DIR = "C:/betterncm/plugins_dev/InfLink-rs";

/** 当前生效的 BetterNCM 插件目标目录（优先读取环境变量 `BETTERNCM_PLUGIN_PATH`） */
export const PLUGIN_DIR =
	process.env.BETTERNCM_PLUGIN_PATH || DEFAULT_PLUGIN_DIR;

/**
 * HMR 开发服务器端口号。
 * 默认 5135，支持通过环境变量 `INFLINK_DEV_PORT` 指定。
 */
export const HMR_PORT = Number(process.env.INFLINK_DEV_PORT || 5135);

/** 开发环境下移除 app.html Content-Security-Policy 限制的 BetterNCM hijack 规则 */
export const CSP_STRIP_HIJACK = {
	type: "regex",
	id: "inflink-dev-strip-csp",
	from: '<meta http-equiv="Content-Security-Policy"[^>]*>',
	to: "<!-- CSP removed by InfLink dev server -->",
} satisfies HijackAction;

/** 开发环境注入 hijack 规则的目标客户端版本范围，与 `manifest.json` 中既有的 hijack 保持一致 */
export const HIJACK_VERSION_RANGE = ">=3.1.21";

/**
 * 引导脚本中端口号的编译期替换占位符。
 *
 * 同一标识符出现在三处，改名时必须同步：本文件、`global.d.ts` 中的常量声明，
 * 以及 `src/dev-bootstrap.ts` 中的使用处。
 */
export const BOOTSTRAP_PORT_PLACEHOLDER = "__INFLINK_HMR_PORT__";
