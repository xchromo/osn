import { Tabs as KobalteTabs } from "@kobalte/core/tabs";
import { splitProps, type Component, type JSX } from "solid-js";

import { cn } from "../../lib/utils";

const Tabs = KobalteTabs;

const TabsList: Component<{ class?: string; children?: JSX.Element }> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KobalteTabs.List class={cn("flex gap-1", local.class)} {...others} />;
};

const TabsTrigger: Component<{
  value: string;
  class?: string;
  children?: JSX.Element;
  disabled?: boolean;
}> = (props) => {
  const [local, others] = splitProps(props, ["class", "value"]);
  return (
    <KobalteTabs.Trigger
      value={local.value}
      class={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        "text-muted-foreground hover:bg-muted",
        "data-[selected]:bg-primary data-[selected]:text-primary-foreground",
        local.class,
      )}
      {...others}
    />
  );
};

const TabsContent: Component<{ value: string; class?: string; children?: JSX.Element }> = (
  props,
) => {
  const [local, others] = splitProps(props, ["class", "value"]);
  return (
    <KobalteTabs.Content
      value={local.value}
      class={cn("mt-2 focus-visible:outline-none", local.class)}
      {...others}
    />
  );
};

export { Tabs, TabsList, TabsTrigger, TabsContent };
