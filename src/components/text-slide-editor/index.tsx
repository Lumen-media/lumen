import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TextSlideMetadata } from "@/types/media";

interface TextSlideEditorProps {
	mediaId: string;
	content: string;
	metadata: TextSlideMetadata;
	onUpdate: (content: string, metadata: TextSlideMetadata) => void;
}

export function TextSlideEditor({ content, metadata, onUpdate }: TextSlideEditorProps) {
	const [localContent, setLocalContent] = useState(content);
	const [localMetadata, setLocalMetadata] = useState(metadata);

	useEffect(() => {
		setLocalContent(content);
		setLocalMetadata(metadata);
	}, [content, metadata]);

	const handleContentChange = (newContent: string) => {
		setLocalContent(newContent);
		onUpdate(newContent, localMetadata);
	};

	const handleMetadataChange = (updates: Partial<TextSlideMetadata>) => {
		const newMetadata = { ...localMetadata, ...updates };
		setLocalMetadata(newMetadata);
		onUpdate(localContent, newMetadata);
	};

	const handleFontSizeChange = (value: number[]) => {
		const fontSize = Math.max(24, value[0]);
		handleMetadataChange({ fontSize });
	};

	return (
		<div className="flex flex-col gap-6 h-full">
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="text-content">Text Content</Label>
					<textarea
						id="text-content"
						value={localContent}
						onChange={(e) => handleContentChange(e.target.value)}
						placeholder="Enter your text here..."
						className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
					/>
				</div>

				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="font-size">Font Size</Label>
						<span className="text-sm text-muted-foreground">{localMetadata.fontSize}px</span>
					</div>
					<Slider
						id="font-size"
						min={24}
						max={120}
						step={2}
						value={[localMetadata.fontSize]}
						onValueChange={handleFontSizeChange}
					/>
					<span className="text-xs text-muted-foreground">Minimum: 24px for readability</span>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="font-color">Font Color</Label>
						<div className="flex items-center gap-2">
							<input
								id="font-color"
								type="color"
								value={localMetadata.fontColor}
								onChange={(e) => handleMetadataChange({ fontColor: e.target.value })}
								className="h-9 w-16 rounded-md border border-input cursor-pointer"
							/>
							<Input
								type="text"
								value={localMetadata.fontColor}
								onChange={(e) => handleMetadataChange({ fontColor: e.target.value })}
								placeholder="#000000"
								className="flex-1"
							/>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="bg-color">Background Color</Label>
						<div className="flex items-center gap-2">
							<input
								id="bg-color"
								type="color"
								value={localMetadata.backgroundColor}
								onChange={(e) => handleMetadataChange({ backgroundColor: e.target.value })}
								className="h-9 w-16 rounded-md border border-input cursor-pointer"
							/>
							<Input
								type="text"
								value={localMetadata.backgroundColor}
								onChange={(e) => handleMetadataChange({ backgroundColor: e.target.value })}
								placeholder="#FFFFFF"
								className="flex-1"
							/>
						</div>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<Label>Text Alignment</Label>
					<ToggleGroup
						type="single"
						value={localMetadata.alignment}
						onValueChange={(value) => {
							if (value) {
								handleMetadataChange({ alignment: value as "left" | "center" | "right" });
							}
						}}
					>
						<ToggleGroupItem value="left" aria-label="Align left">
							<AlignLeft className="h-4 w-4" />
						</ToggleGroupItem>
						<ToggleGroupItem value="center" aria-label="Align center">
							<AlignCenter className="h-4 w-4" />
						</ToggleGroupItem>
						<ToggleGroupItem value="right" aria-label="Align right">
							<AlignRight className="h-4 w-4" />
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
			</div>

			<div className="flex flex-col gap-2 flex-1 min-h-0">
				<Label>Preview</Label>
				<Card className="flex-1 overflow-hidden">
					<div
						className="w-full h-full flex items-center justify-center p-8"
						style={{
							backgroundColor: localMetadata.backgroundColor,
							color: localMetadata.fontColor,
						}}
					>
						<div
							className="w-full break-words whitespace-pre-wrap"
							style={{
								fontSize: `${localMetadata.fontSize}px`,
								textAlign: localMetadata.alignment,
							}}
						>
							{localContent || "Your text will appear here..."}
						</div>
					</div>
				</Card>
			</div>
		</div>
	);
}
