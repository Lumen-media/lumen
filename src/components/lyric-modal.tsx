import { AlignCenter, AlignLeft, AlignRight, Eye, EyeOff, Palette } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Separator } from './ui/separator';
import { Toggle } from './ui/toggle';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

type LyricModalProps = {
  children: React.ReactNode;
};

export const LyricModal = ({ children }: LyricModalProps) => {
  const fonts = [
    { label: 'Inter', value: 'inter' },
    { label: 'Bebas', value: 'bebas' },
    { label: 'Montserrat', value: 'montserrat' },
  ];

  return (
    <Dialog>
      <DialogTrigger>{children}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="w-full sm:max-w-[90dvw] h-full max-h-[80dvh] flex"
      >
        <Card className="flex-1 p-0 gap-0 overflow-hidden">
          <CardHeader className="p-4 flex-row items-center gap-7">
            <h4 className="uppercase">Theme Settings</h4>

            <Select items={fonts}>
              <SelectTrigger className="w-full max-w-44 h-8 bg-background dark:bg-background border-0">
                <SelectValue placeholder="Font" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {fonts.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Input
              className="max-w-44 h-8 bg-background border-0"
              placeholder="Font size"
              defaultValue="18px"
            />

            <Button variant="ghost">
              <Palette /> Global Background
            </Button>

            <Toggle className="ml-auto data-[state=on]:bg-transparent aria-pressed:bg-transparent [&[aria-pressed=true]_.eye-open]:hidden [&[aria-pressed=false]_.eye-closed]:hidden">
              <Eye className="eye-open" />
              <EyeOff className="eye-closed" />
              Live Preview
            </Toggle>
          </CardHeader>
          <Separator />
          <CardContent className="flex-1"></CardContent>
        </Card>

        <Card className="flex-1 max-w-1/5">
          <section className="flex flex-col gap-3">
            <Label className="uppercase text-xs">Text Alignment</Label>
            <ToggleGroup
              defaultValue={['center']}
              variant="secondary"
              spacing={4}
              className="gap-2 p-2 bg-background w-full justify-between"
            >
              <ToggleGroupItem
                value="left"
                aria-label="Toggle left"
                className="flex-1 rounded-[4px]"
              >
                <AlignLeft />
              </ToggleGroupItem>

              <ToggleGroupItem
                value="center"
                aria-label="Toggle center"
                className="flex-1 rounded-[4px]"
              >
                <AlignCenter />
              </ToggleGroupItem>

              <ToggleGroupItem
                value="right"
                aria-label="Toggle right"
                className="flex-1 rounded-[4px]"
              >
                <AlignRight />
              </ToggleGroupItem>
            </ToggleGroup>
          </section>

          <section className="flex flex-col gap-3">
            <Label className="uppercase text-xs">Metadata</Label>
            <Input className="h-8 bg-background border-0" placeholder="Name" />
            <Input className="h-8 bg-background border-0" placeholder="Author" />
            <Input className="h-8 bg-background border-0" placeholder="Notes (Key, BPM...)" />
          </section>

          <section className="flex flex-col gap-3"></section>
          <CardFooter className="flex items-center gap-3 w-full px-0 mt-auto">
            <DialogClose
              className="flex-1 h-auto py-2"
              render={(props) => (
                <Button {...props} variant="secondary">
                  Cancel
                </Button>
              )}
            />
            <Button className="flex-1 h-auto py-2">Save</Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
};
