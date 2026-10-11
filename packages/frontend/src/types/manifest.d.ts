/**
 * @see https://github.com/BetterNCM/BetterNCM-Plugins/blob/master/manifest-schema.json
 */

/**
 * 劫持动作基础配置
 */
export interface HijackActionBase {
	/** 可选的劫持动作 ID */
	id?: string;
}

/**
 * 替换类劫持动作（精确替换或正则替换）
 */
export interface ReplaceOrRegexHijackAction extends HijackActionBase {
	/**
	 * 劫持动作的类型：
	 * - `replace`: 精确替换
	 * - `regex`: 正则匹配替换
	 */
	type: "replace" | "regex";
	/** 被替换的搜索项或正则表达式 */
	from: string;
	/** 替换后的内容 */
	to: string;
}

/**
 * 插入类劫持动作（前置或后置追加）
 */
export interface AppendOrPrependHijackAction extends HijackActionBase {
	/**
	 * 劫持动作的类型：
	 * - `append`: 在目标后追加代码
	 * - `prepend`: 在目标前插入代码
	 */
	type: "append" | "prepend";
	/** 需要追加或前置的代码 */
	code: string;
}

/**
 * 劫持动作定义
 */
export type HijackAction =
	| ReplaceOrRegexHijackAction
	| AppendOrPrependHijackAction;

/**
 * 注入脚本项
 */
export interface InjectedScript {
	/**
	 * 脚本文件的相对路径，必须以 .js 或 .mjs 结尾
	 * @pattern ^.+\.(m?js)$
	 */
	file: string;
}

/**
 * 页面/路径脚本注入映射表
 * Key: 页面路径或匹配规则
 */
export type InjectsConfig = Record<string, InjectedScript[]>;

/**
 * 网易云请求拦截与修改映射表
 * 第一层 Key: 目标网易云版本（支持 SemVer Range，例如 `>=2.10.0` 或 `*`）
 * 第二层 Key: 需要匹配拦截的 URL 前缀
 */
export type HijacksConfig = Record<
	string,
	Record<string, HijackAction | HijackAction[]>
>;

/**
 * BetterNCM 插件的元数据配置文件
 */
export interface BetterNCMPluginManifest {
	/** JSON Schema 的 URL 或本地路径 */
	$schema?: string;

	/**
	 * manifest 版本，固定为 1
	 */
	manifest_version: 1;

	/** 插件名 */
	name: string;

	/** 插件版本，推荐使用语义化版本（https://semver.org/） */
	version: string;

	/** 插件作者 */
	author: string;

	/** 若为其他插件的变体/Fork，此用于标记源插件的 slug */
	fork_of?: string;

	/**
	 * 插件唯一识别名（仅支持英文、数字、横杠与下划线）。
	 * 留空则根据插件名自动生成；若插件名含中文则必填。
	 * @pattern ^[a-zA-Z0-9_-]+$
	 */
	slug?: string;

	/** 依赖的 BetterNCM 版本，支持 SemVer 范围（如 >=1.0.0） */
	betterncm_version?: string;

	/** 作者链接 */
	author_link?: string;

	/** 插件描述 */
	description?: string;

	/** 插件预览图 */
	preview?: string;

	/**
	 * 插件类型
	 * @default "extension"
	 */
	type?: "extension" | "theme" | "dependency";

	/** 是否要求重启网易云音乐客户端以加载插件，不填则通过是否存在 native_plugin 判断 */
	require_restart?: boolean;

	/** 依赖的其他插件的 Slug 列表 */
	requirements?: string[];

	/** 是否禁用自带的开发重载功能，适用于自制热重载的插件，默认不禁用 */
	noDevReload?: boolean;

	/** 在指定的插件之前加载（插件 Slug 列表） */
	loadBefore?: string[];

	/** 在指定的插件之后加载（插件 Slug 列表） */
	loadAfter?: string[];

	/** 强制安装（需要在审核中告知理由） */
	"force-install"?: boolean;

	/** 强制更新范围，如 `< 0.1.0` 表示强制低于此版本的插件更新 */
	"force-update"?: string;

	/** 强制卸载（适用于插件崩了的情况） */
	"force-uninstall"?: boolean;

	/** 是否兼容网易云 3.0.0+ 版本 */
	"ncm3-compatible"?: boolean;

	/** 启动脚本文件路径，此处的脚本将在网易云的窗口及浏览器页面初始化时被调用 */
	startup_script?: string;

	/** 兼容的网易云音乐具体版本范围 */
	"ncm-version-req"?: string;

	/** 在指定页面或路径下需要注入的脚本文件 */
	injects?: InjectsConfig;

	/** 网易云请求拦截与修改配置 */
	hijacks?: HijacksConfig;

	/** 需要注入的 native dll 文件路径，接口参考文档及已有 native 插件 */
	native_plugin?: string;
}
