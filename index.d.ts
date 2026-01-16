export interface ApukoneClientOptions {
    host: string;
    token: string;
    onMessage: (messages: any[]) => Promise<any>;
}

export declare const ApukoneClient: (options: ApukoneClientOptions) => void;
