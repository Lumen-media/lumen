import { useAutoTranslation } from "../hooks/useAutoTranslation";

/**
 * Test component to verify i18next integration with automatic translation
 * This component demonstrates the missing key handler functionality
 */
export function TranslationTest() {
	const { t, currentLanguage, availableLanguages, changeLanguage, isLoading } =
		useAutoTranslation();

	return (
		<div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
			<h3 className="text-lg font-semibold mb-4">Translation Integration Test</h3>

			<div className="space-y-2 mb-4">
				<p>
					<strong>Current Language:</strong> {currentLanguage}
				</p>
				<p>
					<strong>Available Languages:</strong> {availableLanguages.join(", ")}
				</p>
				<p>
					<strong>Loading:</strong> {isLoading ? "Yes" : "No"}
				</p>
			</div>

			<div className="space-y-2 mb-4">
				<h4 className="font-medium">Test Translations:</h4>
				<p>
					<strong>Existing key:</strong> {t("welcome")}
				</p>
				<p>
					<strong>New key (will trigger auto-translation):</strong> {t("test.auto.translation")}
				</p>
				<p>
					<strong>Nested key:</strong> {t("player.controls.play")}
				</p>
				<p>
					<strong>With variables:</strong> {t("user.greeting", { name: "John" })}
				</p>
			</div>

			<div className="space-x-2">
				{availableLanguages.map((lang) => (
					<button
						key={lang}
						type="button"
						onClick={() => changeLanguage(lang)}
						disabled={isLoading || lang === currentLanguage}
						className="px-3 py-1 bg-blue-500 text-white rounded disabled:opacity-50"
					>
						{lang.toUpperCase()}
					</button>
				))}
			</div>
		</div>
	);
}
