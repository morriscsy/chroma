import { createFileRoute } from "@tanstack/react-router";
import { PaletteStudio } from "@/components/palette-studio";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <PaletteStudio />;
}
