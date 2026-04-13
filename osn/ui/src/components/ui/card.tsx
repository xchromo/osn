import { splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "../../lib/utils";

const Card: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("bg-card text-card-foreground rounded-xl border border-border", local.class)}
      {...others}
    />
  );
};

const CardHeader: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col space-y-1.5 p-4", local.class)} {...others} />;
};

const CardTitle: Component<ComponentProps<"h3">> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <h3
      class={cn("text-foreground text-base font-semibold leading-none tracking-tight", local.class)}
      {...others}
    >
      {local.children}
    </h3>
  );
};

const CardDescription: Component<ComponentProps<"p">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <p class={cn("text-muted-foreground text-sm", local.class)} {...others} />;
};

const CardContent: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("p-4 pt-0", local.class)} {...others} />;
};

const CardFooter: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex items-center p-4 pt-0", local.class)} {...others} />;
};

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
