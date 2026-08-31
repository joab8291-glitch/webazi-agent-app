export type UssdResultPayload = {
  result: string;
  success: boolean;
};

export type UssdExecutorModuleEvents = {
  onUssdResult: (params: UssdResultPayload) => void;
};
