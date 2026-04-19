import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface DevicePermissions {
  player: boolean;
  lyrics: boolean;
  bible: boolean;
  media: boolean;
}

export interface Device {
  device_id: string;
  device_name: string;
  device_type: string;
  os: string;
  version: string;
  access_token: string;
  is_active: boolean;
  permissions: DevicePermissions;
  registered_at: number;
  last_connected_at?: number | null;
}

export interface RemoteAccessSettings {
  remote_enabled: boolean;
  transmission_enabled: boolean;
}

export interface RegistrationTokenPayload {
  token: string;
  expires_at: number;
}

class DevicesService {
  async getDevices(): Promise<Device[]> {
    return invoke<Device[]>('get_devices');
  }

  async getRemoteAccessSettings(): Promise<RemoteAccessSettings> {
    return invoke<RemoteAccessSettings>('get_remote_access_settings');
  }

  async updateRemoteAccessSettings(
    settings: RemoteAccessSettings
  ): Promise<RemoteAccessSettings> {
    return invoke<RemoteAccessSettings>('update_remote_access_settings', {
      remoteEnabled: settings.remote_enabled,
      transmissionEnabled: settings.transmission_enabled,
    });
  }

  async getLocalIp(): Promise<string> {
    return invoke<string>('get_local_ip');
  }

  async generateRegistrationToken(): Promise<RegistrationTokenPayload> {
    return invoke<RegistrationTokenPayload>('gen_reg_token');
  }

  async toggleDevice(deviceId: string, isActive: boolean): Promise<void> {
    await invoke('toggle_device', { deviceId, isActive });
  }

  async updateDevicePermissions(
    deviceId: string,
    permissions: DevicePermissions
  ): Promise<void> {
    await invoke('update_device_permissions', { deviceId, permissions });
  }

  async removeDevice(deviceId: string): Promise<void> {
    await invoke('remove_device', { deviceId });
  }

  async onDeviceRegistered(handler: (device: Device) => void): Promise<UnlistenFn> {
    return listen<Device>('device_registered', (event) => handler(event.payload));
  }

  async onDeviceUpdated(handler: (device: Device) => void): Promise<UnlistenFn> {
    return listen<Device>('device_updated', (event) => handler(event.payload));
  }

  async onDeviceAuthenticated(handler: (device: Device) => void): Promise<UnlistenFn> {
    return listen<Device>('device_authenticated', (event) => handler(event.payload));
  }

  async onDeviceDeactivated(handler: (device: Device) => void): Promise<UnlistenFn> {
    return listen<Device>('device_updated', (event) => {
      if (event.payload?.is_active === false) {
        handler(event.payload);
      }
    });
  }

  async onDeviceRemoved(handler: (deviceId: string) => void): Promise<UnlistenFn> {
    return listen<string>('device_removed', (event) => handler(event.payload));
  }
}

export const devicesService = new DevicesService();
