import { FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMediaStore } from "@/store/mediaStore";
import type { TextSlideMetadata } from "@/types/media";

interface AddTextSlideDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function AddTextSlideDialog({ open, onOpenChange }: AddTextSlideDialogProps) {
	const addMediaItem = useMediaStore((state) => state.addMediaItem);
	const [title, setTitle] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!title.trim()) {
			return;
		}

		setIsSubmitting(true);

		try {
			const metadata: TextSlideMetadata = {
				content: "",
				fontSize: 48,
				fontColor: "#FFFFFF",
				backgroundColor: "#1E40AF",
				alignment: "center",
			};

			addMediaItem({
				type: "text",
				title: title.trim(),
				metadata,
			});

			setTitle("");
			onOpenChange(false);
		} catch (error) {
			console.error("Failed to create text slide:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleCancel = () => {
		setTitle("");
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FileText className="h-5 w-5" />
						Add Text Slide
					</DialogTitle>
					<DialogDescription>Create a new text slide for your presentation.</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="title">Title *</Label>
							<Input
								id="title"
								placeholder="Enter slide title..."
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								autoFocus
								required
							/>
							<p className="text-xs text-muted-foreground">
								Give your text slide a descriptive title
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button type="submit" disabled={!title.trim() || isSubmitting}>
							{isSubmitting ? "Creating..." : "Create Slide"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
