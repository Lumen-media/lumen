import { useEffect, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "./ui/command";
import { Dialog, DialogContent } from "./ui/dialog";

export function QuickShortcutsModal() {
	const [isOpen, setIsOpen] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey && event.key === "k") {
				event.preventDefault();
				setIsOpen((prev) => !prev);
			}
		};

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogContent className="p-0 overflow-hidden">
				<Command>
					<CommandInput placeholder="Type a command or search..." />
					<CommandList>
						<CommandEmpty>No results found.</CommandEmpty>
						<CommandGroup heading="Suggestions">
							<CommandItem>
								<span>Search for files</span>
							</CommandItem>
							<CommandItem>
								<span>Create new task</span>
							</CommandItem>
							<CommandItem>
								<span>Go to settings</span>
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
