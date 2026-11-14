import { createFileRoute } from "@tanstack/react-router";
import { BurningApp } from "@/components/burning-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <BurningApp />;
}
