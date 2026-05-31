import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Toggle, toggleVariants } from "@/components/ui/toggle";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Combobox } from "@/components/ui/combobox";

import {
  Dialog as _Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  AlertDialog as _AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  Card as _Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Tabs as _Tabs,
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import {
  Select as _Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Tooltip as _Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  Popover as _Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  DropdownMenu as _DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Table as _Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Avatar as _Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";

import {
  Drawer as _Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

import {
  Empty as _Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import {
  InputGroup as _InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

import {
  ScrollArea as _ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area";

import {
  TextEditor as _TextEditor,
  type TextEditorRef,
} from "@/components/text-editor";

import { TextEditorToolbar } from "@/components/text-editor-toolbar";

import {
  TextEditorBubbleMenu,
  type BubbleMenuItem,
} from "@/components/text-editor-bubble-menu";

const Dialog = Object.assign(_Dialog, {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
});

const AlertDialog = Object.assign(_AlertDialog, {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
});

const Card = Object.assign(_Card, {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
});

const Tabs = Object.assign(_Tabs, {
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
});

const Select = Object.assign(_Select, {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
});

const Tooltip = Object.assign(_Tooltip, {
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
});

const Popover = Object.assign(_Popover, {
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
});

const DropdownMenu = Object.assign(_DropdownMenu, {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
});

const Table = Object.assign(_Table, {
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
});

const Avatar = Object.assign(_Avatar, {
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
});

const Drawer = Object.assign(_Drawer, {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
});

const Empty = Object.assign(_Empty, {
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
});

const InputGroup = Object.assign(_InputGroup, {
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
});

const ScrollArea = Object.assign(_ScrollArea, {
  ScrollBar,
});

const TextEditor = Object.assign(_TextEditor, {
  Toolbar: TextEditorToolbar,
  BubbleMenu: TextEditorBubbleMenu,
});

export {
  Button,
  type ButtonProps,
  Input,
  Textarea,
  Label,
  Switch,
  Separator,
  Badge,
  Skeleton,
  Slider,
  Checkbox,
  Progress,
  Toggle,
  toggleVariants,
  Kbd,
  KbdGroup,
  Combobox,
  Dialog,
  AlertDialog,
  Card,
  Tabs,
  Select,
  Tooltip,
  Popover,
  DropdownMenu,
  Table,
  Avatar,
  Drawer,
  Empty,
  InputGroup,
  ScrollArea,
  TextEditor,
  type TextEditorRef,
  type BubbleMenuItem,
};
