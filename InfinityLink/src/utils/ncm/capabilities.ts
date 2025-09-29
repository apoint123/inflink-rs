/**
 * @author richardo2016
 * @email richardo2016@gmail.com
 * @create date 2022-03-14 17:56:30
 * @modify date 2022-03-14 17:56:30
 *
 * @desc 按平台分类的的一些能力检测, 按照 <platform>.<capability> 表达
 */

function parseOSVer(osVer: string): [number, number, number] | undefined {
	const match = osVer.match(/\d+\.\d+(\.\d+)*/);
	if (match) {
		const versionString = match[0];
		const split = versionString.split(".");
		if (split.length === 2) {
			split.push("0");
		}
		return split.map((x) => parseInt(x, 10)) as [number, number, number];
	}
}

function formatOsVer(
	a: string | number,
	b: string | number,
	c: string | number,
): number {
	const numA = parseInt(String(a), 10) || 0;
	const numB = parseInt(String(b), 10) || 0;
	const numC = parseInt(String(c), 10) || 0;

	return numA * 10000 + numB * 100 + numC;
}

type ICapabilityCheckResult = {
	isSupport: boolean;
	extra?: object;
};
/**
 * @description 检测运行的环境中是否支持某种能力
 * @param capability 待检测的能力
 * @returns
 */
export async function isSupport<T>(
	capability: T,
	// options?: {
	//     platform?: IPlatform
	// }
): Promise<ICapabilityCheckResult> {
	const ret: ICapabilityCheckResult = {
		isSupport: false,
	};

	switch (capability) {
		case "appleLogin": {
			// if ((window as any)?.APP_CONF?.channel === 'appstore') {
			//     return false;
			// }

			if (!isOrpheusDarwin()) {
				ret.isSupport = false;
				break;
			}

			const osVer = await legacyNativeCmder.call<string>("os.queryOsVer");
			let parsed = parseOSVer(osVer);
			if (!parsed) {
				ret.isSupport = false;
				break;
			}

			// 小于 10.15 的系统版本都不支持
			if (formatOsVer(...parsed) <= 101500) {
				ret.isSupport = false;
				break;
			}

			const appVerInfo = await legacyNativeCmder.call<{
				version: string;
				build: string;
			}>("update.getVisualVersion");
			parsed = parseOSVer(appVerInfo.version);
			if (!parsed) {
				ret.isSupport = false;
				break;
			}

			// < 2.3.8 的版本都不支持 apple login
			if (formatOsVer(...parsed) < 20308) {
				ret.isSupport = false;
			} else if (
				formatOsVer(...parsed) === 20308 &&
				!["873", "874", "875", "876", "877", "878"].includes(
					`${appVerInfo.build}`,
				)
			) {
				// = 2.3.8, 不符合这 6 个 build 版本号的不是 appstore 包, 也不支持
				ret.isSupport = false;
			} else {
				// > 2.3.8 靠原生接口判断
				const { status } = await needLoginFromApple();
				ret.isSupport = status === 200;
			}
			break;
		}
		default:
			throw new Error(`[isSupport] unknown capability`);
	}
	return ret;
}

declare global {
	interface Window {
		niIsSupportCapability: typeof isSupport;
	}
}

if (typeof window.niIsSupportCapability !== "function")
	window.niIsSupportCapability = isSupport;

function isOrphuesWKWebkit() {
	return "webkit" in window;
}

function isOrpheusWebkit() {
	return isOrphuesWKWebkit() || (!isWin32CEF() && !!window.channel);
}

function isOrpheusDarwin() {
	return isOrphuesWKWebkit() || isOrpheusWebkit();
}

function isWin32CEF() {
	return window.navigator.userAgent.indexOf("Chrome/") > -1;
}

/**
 * @description 判断当前环境是否支持通过 apple id 登录
 */
async function needLoginFromApple() {
	return legacyNativeCmder.call<{ status: 200 | 400 }>(
		"app.needLoginFromApple",
	);
}
