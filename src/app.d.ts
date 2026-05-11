declare global {
  namespace App {
    interface Locals {
      onboardingCompleted: boolean;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
    interface Error {
      message: string;
      code?: string;
    }
  }
}

export {};
