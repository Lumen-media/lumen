import { useState } from "react";
import { cliService } from "../lib/translation";
import { Button } from "./ui/button";

export function CLITest() {
	const [output, setOutput] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [languageCode, setLanguageCode] = useState("");
	const [languageName, setLanguageName] = useState("");

	const addOutput = (message: string) => {
		setOutput((prev) => [...prev, message]);
	};

	const clearOutput = () => {
		setOutput([]);
	};

	const handleAddLanguage = async () => {
		if (!languageCode || !languageName) {
			addOutput("❌ Please provide both language code and name");
			return;
		}

		setIsLoading(true);
		try {
			addOutput(`🚀 Adding language: ${languageName} (${languageCode})`);

			const validation = cliService.validateAndSuggest(languageCode);
			if (!validation.valid) {
				addOutput(`❌ Invalid language code: ${languageCode}`);
				if (validation.suggestions && validation.suggestions.length > 0) {
					addOutput("💡 Suggestions:");
					validation.suggestions.forEach((suggestion) => {
						const name = cliService.getSuggestedLanguageName(suggestion);
						addOutput(`   ${suggestion} - ${name}`);
					});
				}
				return;
			}

			cliService.onProgress("Adding Language", (progress, details) => {
				addOutput(`Progress: ${progress}% ${details ? `- ${details}` : ""}`);
			});

			await cliService.addLanguage(languageCode, languageName);
			addOutput(`✅ Successfully added ${languageName} (${languageCode})`);

			setLanguageCode("");
			setLanguageName("");
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			addOutput(`❌ Error: ${errorMessage}`);
		} finally {
			cliService.offProgress("Adding Language");
			setIsLoading(false);
		}
	};

	const handleShowLanguages = () => {
		addOutput("📋 Available Languages:");
		const availableLanguages = cliService.getCommonLanguages();
		Object.entries(availableLanguages).forEach(([code, name]) => {
			addOutput(`   ${code} - ${name}`);
		});
	};

	const handleShowProgress = async () => {
		if (!languageCode) {
			addOutput("❌ Please provide a language code");
			return;
		}

		setIsLoading(true);
		try {
			const progress = await cliService.getTranslationProgress(languageCode);
			const percentage =
				progress.total > 0 ? Math.round((progress.translated / progress.total) * 100) : 0;

			addOutput(`📊 Translation Progress for ${languageCode}:`);
			addOutput(`   Total keys: ${progress.total}`);
			addOutput(`   Translated: ${progress.translated}`);
			addOutput(`   Pending: ${progress.pending}`);
			addOutput(`   Progress: ${percentage}%`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			addOutput(`❌ Error: ${errorMessage}`);
		} finally {
			setIsLoading(false);
		}
	};

	const handleTranslateAll = async () => {
		if (!languageCode) {
			addOutput("❌ Please provide a target language code");
			return;
		}

		setIsLoading(true);
		try {
			addOutput(`🔄 Starting translation to ${languageCode}...`);

			let processedKeys = 0;
			for await (const progress of cliService.translateAllKeys("en", languageCode)) {
				processedKeys++;
				if (processedKeys % 5 === 0) {
					// Update every 5 keys to avoid spam
					addOutput(`Progress: ${progress.progress}% (${processedKeys} keys processed)`);
				}
			}

			addOutput(`✅ Translation completed for ${languageCode}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			addOutput(`❌ Translation failed: ${errorMessage}`);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="p-6 max-w-4xl mx-auto">
			<h2 className="text-2xl font-bold mb-6">CLI Service Test</h2>

			<div className="mb-6 p-4 border rounded-lg">
				<h3 className="text-lg font-semibold mb-4">Language Management</h3>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
					<div>
						<label htmlFor="language-code" className="block text-sm font-medium mb-2">
							Language Code (e.g., es, fr, de)
						</label>
						<input
							id="language-code"
							type="text"
							value={languageCode}
							onChange={(e) => setLanguageCode(e.target.value)}
							className="w-full px-3 py-2 border rounded-md"
							placeholder="es"
							disabled={isLoading}
						/>
					</div>

					<div>
						<label htmlFor="language-name" className="block text-sm font-medium mb-2">
							Language Name (e.g., Español)
						</label>
						<input
							id="language-name"
							type="text"
							value={languageName}
							onChange={(e) => setLanguageName(e.target.value)}
							className="w-full px-3 py-2 border rounded-md"
							placeholder="Español"
							disabled={isLoading}
						/>
					</div>
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						onClick={handleAddLanguage}
						disabled={isLoading}
						className="bg-blue-600 hover:bg-blue-700"
					>
						Add Language
					</Button>

					<Button onClick={handleShowProgress} disabled={isLoading} variant="outline">
						Show Progress
					</Button>

					<Button
						onClick={handleTranslateAll}
						disabled={isLoading}
						className="bg-green-600 hover:bg-green-700"
					>
						Translate All Keys
					</Button>

					<Button onClick={handleShowLanguages} disabled={isLoading} variant="outline">
						Show Common Languages
					</Button>

					<Button onClick={clearOutput} disabled={isLoading} variant="outline">
						Clear Output
					</Button>
				</div>
			</div>

			{/* Output Section */}
			<div className="border rounded-lg">
				<div className="bg-gray-50 px-4 py-2 border-b">
					<h3 className="text-lg font-semibold">CLI Output</h3>
				</div>

				<div className="p-4 bg-black text-green-400 font-mono text-sm max-h-96 overflow-y-auto">
					{output.length === 0 ? (
						<div className="text-gray-500">No output yet. Try running a command above.</div>
					) : (
						output.map((line, index) => (
							<div key={`output-${index}-${line.slice(0, 10)}`} className="mb-1">
								{line}
							</div>
						))
					)}

					{isLoading && <div className="text-yellow-400 animate-pulse">⏳ Processing...</div>}
				</div>
			</div>

			{/* Help Section */}
			<div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
				<h3 className="text-lg font-semibold mb-2">CLI Commands Available</h3>
				<div className="text-sm space-y-1">
					<div>
						<code>npm run translate add-language &lt;code&gt; &lt;name&gt;</code> - Add new language
					</div>
					<div>
						<code>npm run translate translate-all &lt;from&gt; &lt;to&gt;</code> - Translate all
						keys
					</div>
					<div>
						<code>npm run translate progress &lt;language&gt;</code> - Show progress
					</div>
					<div>
						<code>npm run translate list</code> - List available languages
					</div>
					<div>
						<code>npm run translate stats</code> - Show translation statistics
					</div>
				</div>
			</div>
		</div>
	);
}
