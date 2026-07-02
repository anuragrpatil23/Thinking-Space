import {
  clearAiManualCredentialsBlock,
  getManualAzureCredentialsBlock,
  getManualClaudeApiKeyBlock,
  getManualOpenSourceAiCredentialsBlock,
  getManualOpenAiApiKeyBlock,
  setManualOpenSourceAiCredentialsBlock,
  setManualAzureCredentialsBlock,
  setManualClaudeCredentialsBlock,
  setManualOpenAiCredentialsBlock,
} from '@/services/lego_blocks/integrations/aiCredentialStoreBlock'
import { invalidateServerProfileBlock } from '@/services/lego_blocks/units/intelligence/serverProfileBlock'

export interface NativeAiLoginState {
  claudeApiKey: string
  openAiApiKey: string
  azureApiKey: string
  azureEndpoint: string
  azureDeployment: string
  azureApiVersion: string
  openSourceAiBaseUrl: string
  openSourceAiApiKey: string
  openSourceAiModel: string
}

export function getNativeAiLoginStateOrch(): NativeAiLoginState {
  const azure = getManualAzureCredentialsBlock()
  const openSourceAi = getManualOpenSourceAiCredentialsBlock()
  return {
    claudeApiKey: getManualClaudeApiKeyBlock() ?? '',
    openAiApiKey: getManualOpenAiApiKeyBlock() ?? '',
    azureApiKey: azure?.apiKey ?? '',
    azureEndpoint: azure?.endpoint ?? '',
    azureDeployment: azure?.deployment ?? '',
    azureApiVersion: azure?.apiVersion ?? '',
    openSourceAiBaseUrl: openSourceAi?.baseUrl ?? '',
    openSourceAiApiKey: openSourceAi?.apiKey ?? '',
    openSourceAiModel: openSourceAi?.model ?? '',
  }
}

export function setNativeClaudeLoginOrch(apiKey: string): NativeAiLoginState {
  setManualClaudeCredentialsBlock(apiKey)
  return getNativeAiLoginStateOrch()
}

export function setNativeOpenAiLoginOrch(apiKey: string): NativeAiLoginState {
  setManualOpenAiCredentialsBlock(apiKey)
  return getNativeAiLoginStateOrch()
}

export function setNativeAzureLoginOrch(input: {
  apiKey: string
  endpoint?: string
  deployment?: string
  apiVersion?: string
}): NativeAiLoginState {
  setManualAzureCredentialsBlock(input)
  return getNativeAiLoginStateOrch()
}

export function setNativeOpenSourceAiLoginOrch(input: {
  baseUrl?: string
  apiKey?: string
  model?: string
}): NativeAiLoginState {
  setManualOpenSourceAiCredentialsBlock(input)
  // Force re-discovery on next call so a new base URL / cleared model is
  // picked up immediately instead of waiting for the 60s TTL.
  invalidateServerProfileBlock()
  return getNativeAiLoginStateOrch()
}

export function clearNativeAiLoginsOrch(): NativeAiLoginState {
  clearAiManualCredentialsBlock()
  invalidateServerProfileBlock()
  return getNativeAiLoginStateOrch()
}
