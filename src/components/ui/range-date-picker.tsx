"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import * as React from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface RangeDatePickerProps extends React.HTMLAttributes<HTMLDivElement> {
	date?: DateRange;
	onDateChange?: (date: DateRange | undefined) => void;
}

export function RangeDatePicker({
	className,
	date,
	onDateChange,
	...props
}: RangeDatePickerProps) {
	const [selectedDate, setSelectedDate] = React.useState<DateRange | undefined>(
		date,
	);

	React.useEffect(() => {
		setSelectedDate(date);
	}, [date]);

	const handleDateSelect = (range: DateRange | undefined) => {
		setSelectedDate(range);
		onDateChange?.(range);
	};

	return (
		<div className={cn("grid gap-2", className)} {...props}>
			<Popover>
				<PopoverTrigger asChild>
					<Button
						id="date"
						variant={"outline"}
						className={cn(
							"w-[300px] justify-start text-left font-normal",
							!selectedDate && "text-muted-foreground",
						)}
					>
						<CalendarIcon className="mr-2 h-4 w-4" />
						{selectedDate?.from ? (
							selectedDate.to ? (
								<>
									{format(selectedDate.from, "LLL dd, y")} -{" "}
									{format(selectedDate.to, "LLL dd, y")}
								</>
							) : (
								format(selectedDate.from, "LLL dd, y")
							)
						) : (
							<span>Pick a date range</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar
						initialFocus
						mode="range"
						defaultMonth={selectedDate?.from}
						selected={selectedDate}
						onSelect={handleDateSelect}
						numberOfMonths={2}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}
