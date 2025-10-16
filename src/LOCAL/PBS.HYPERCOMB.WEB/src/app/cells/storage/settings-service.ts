import { inject } from "@angular/core";
import { SettingsRepository } from "src/app/database/repository/settings-repository";
import { effect } from "src/app/performance/effect-profiler";
import { HIVE_CONTROLLER_ST } from "src/app/shared/tokens/i-hive-store.token";
import { ISettingsService } from "src/app/shared/tokens/i-hypercomb.token";

export interface IOpfsMetadata {
    name: string,
    background: string
}

export interface IOpfsMetadataItems {
    hives: IOpfsMetadata[],
    lastUpdated?: string
}

export class SettingsService implements ISettingsService {
    public readonly repository = inject(SettingsRepository)

    public getOpfsMetadata = async (): Promise<IOpfsMetadataItems | undefined> => {
        return await this.repository.get<IOpfsMetadataItems>('opfs-metadata') || { hives: [] }
    }

    public saveOpfsMetadata = async (metadata: IOpfsMetadataItems): Promise<void> => {
        await this.repository.put('opfs-metadata', metadata)
    }
}