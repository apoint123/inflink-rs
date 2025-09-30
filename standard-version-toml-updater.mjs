const versionRegex = /version\s*=\s*"(.*)"/;

export function readVersion(contents) {
	const match = contents.match(versionRegex);
	if (!match) {
		throw new Error("在 Cargo.toml 中找不到版本号");
	}
	return match[1];
}

export function writeVersion(contents, version) {
	return contents.replace(versionRegex, `version = "${version}"`);
}
