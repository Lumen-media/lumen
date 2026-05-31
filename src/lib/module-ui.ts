import {
  Button,
  type ButtonProps,
} from "@/components/ui/button";

import {
  Input,
} from "@/components/ui/input";

import {
  Textarea,
} from "@/components/ui/textarea";

import {
  Label,
} from "@/components/ui/label";

import {
  Switch,
} from "@/components/ui/switch";

import {
  Separator,
} from "@/components/ui/separator";

import {
  Badge,
} from "@/components/ui/badge";

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
  ScrollArea as _ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area";

// ─── Namespace-wrapped compound components ───────────────────────────────────

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

const ScrollArea = Object.assign(_ScrollArea, {
  ScrollBar,
});

// ─── Exports ─────────────────────────────────────────────────────────────────

export {
  Button,
  type ButtonProps,
  Input,
  Textarea,
  Label,
  Switch,
  Separator,
  Badge,
  Dialog,
  Card,
  Tabs,
  Select,
  Tooltip,
  ScrollArea,
};
