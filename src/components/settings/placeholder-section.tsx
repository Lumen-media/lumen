'use client';

import { Card, CardContent, CardHeader } from '../ui/card';
import { Separator } from '../ui/separator';

interface PlaceholderSectionProps {
  title: string;
  description: string;
}

export function PlaceholderSection({ title, description }: PlaceholderSectionProps) {
  return (
    <Card className="p-0 gap-0 overflow-hidden">
      <CardHeader className="p-4 flex-row items-center">
        <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
          {title}
        </h4>
      </CardHeader>
      <Separator />
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
