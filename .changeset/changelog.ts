import type { ChangelogFunctions } from "@changesets/types";

const changelogFunctions: ChangelogFunctions = {
	getReleaseLine: async (changeset) => {
		const [firstLine, ...futureLines] = changeset.summary
			.split("\n")
			.map((l) => l.trimEnd());

		let line = firstLine;
		const hashMatch = firstLine.match(/^([0-9a-f]{7,40}):\s*(.*)$/i);

		if (hashMatch) {
			line = `${hashMatch[1].slice(0, 7)}: ${hashMatch[2]}`;
		} else if (changeset.commit) {
			line = `${changeset.commit.slice(0, 7)}: ${firstLine}`;
		}

		let returnVal = `- ${line}`;
		if (futureLines.length > 0) {
			returnVal += `\n${futureLines.map((l) => `  ${l}`).join("\n")}`;
		}
		return returnVal;
	},

	getDependencyReleaseLine: async (changesets, dependenciesUpdated) => {
		if (dependenciesUpdated.length === 0) return "";
		const changesetLinks = changesets.map(
			(changeset) =>
				`- Updated dependencies${
					changeset.commit ? ` [${changeset.commit.slice(0, 7)}]` : ""
				}`,
		);
		const updatedDependenciesList = dependenciesUpdated.map(
			(dependency) => `  - ${dependency.name}@${dependency.newVersion}`,
		);
		return [...changesetLinks, ...updatedDependenciesList].join("\n");
	},
};

export default changelogFunctions;
