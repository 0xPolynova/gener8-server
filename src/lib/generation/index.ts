import { env } from "@/lib/config/env";
import type { CreateGenerationInput, VideoGenerationProvider } from "./provider";
import { mockProvider } from "./mock";
import { openRouterProvider } from "./openrouter";
import { atlasCloudProvider } from "./atlascloud";
import { falProvider } from "./fal";
import { waveSpeedProvider } from "./wavespeed";

function namedProvider(name: string): VideoGenerationProvider | null {
  switch (name.toLowerCase()) {
    case "wavespeed":
      return waveSpeedProvider;
    case "fal":
    case "falai":
    case "seedance":
      return falProvider;
    case "atlascloud":
    case "atlas":
      return atlasCloudProvider;
    case "openrouter":
      return openRouterProvider;
    case "mock":
      return mockProvider;
    default:
      return null;
  }
}

export function getVideoProvider(name?: string | null): VideoGenerationProvider {
  if (name) {
    const match = namedProvider(name);
    if (match) return match;
  }
  return namedProvider(env.videoProvider) ?? mockProvider;
}

export function providerForGeneration(input: CreateGenerationInput) {
  if (input.referenceVideoUrl) return waveSpeedProvider;
  return openRouterProvider;
}
