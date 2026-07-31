import { useMutation, useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  CollectionPropertyType,
  CreatablePropertyType,
  createProperty,
  createRow,
  deleteProperty,
  deleteRow,
  getCollectionInfo,
  ICollectionInfo,
  ICollectionProperty,
  ICollectionRow,
  ICollectionView,
  listRows,
  updateProperty,
  updateRow,
  updateView,
} from "@/features/collection/services/collection-service";
import { queryClient } from "@/main.tsx";

export function useCollectionInfoQuery(
  pageId: string,
): UseQueryResult<ICollectionInfo, Error> {
  return useQuery({
    queryKey: ["collection-info", pageId],
    queryFn: () => getCollectionInfo({ pageId }),
    enabled: !!pageId,
  });
}

export function useRowsListQuery(
  collectionPageId: string,
  viewId: string,
): UseQueryResult<{ rows: ICollectionRow[] }, Error> {
  return useQuery({
    queryKey: ["collection-rows", collectionPageId, viewId],
    queryFn: () => listRows({ collectionPageId, viewId }),
    enabled: !!collectionPageId && !!viewId,
  });
}

export function useCreateRowMutation(collectionPageId: string) {
  return useMutation<ICollectionRow, Error, void>({
    mutationFn: () => createRow({ collectionPageId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collection-rows", collectionPageId],
      });
    },
  });
}

export function useUpdateRowMutation(collectionPageId: string) {
  return useMutation<
    ICollectionRow,
    Error,
    { rowId: string; cells: Record<string, any> }
  >({
    mutationFn: (data) => updateRow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collection-rows", collectionPageId],
      });
    },
  });
}

export function useDeleteRowMutation(collectionPageId: string) {
  return useMutation<void, Error, { rowId: string }>({
    mutationFn: (data) => deleteRow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collection-rows", collectionPageId],
      });
    },
  });
}

export function useCreatePropertyMutation(collectionPageId: string) {
  return useMutation<
    ICollectionProperty,
    Error,
    { name: string; type: CreatablePropertyType; typeOptions?: any }
  >({
    mutationFn: (data) => createProperty({ collectionPageId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collection-info", collectionPageId],
      });
    },
  });
}

export function useUpdatePropertyMutation(collectionPageId: string) {
  return useMutation<
    ICollectionProperty,
    Error,
    { id: string; name?: string; typeOptions?: any; position?: string }
  >({
    mutationFn: (data) => updateProperty({ collectionPageId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collection-info", collectionPageId],
      });
    },
  });
}

export function useDeletePropertyMutation(collectionPageId: string) {
  return useMutation<void, Error, { id: string }>({
    mutationFn: (data) => deleteProperty({ collectionPageId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collection-info", collectionPageId],
      });
    },
  });
}

export function useUpdateViewMutation(collectionPageId: string) {
  return useMutation<
    ICollectionView,
    Error,
    { id: string; config?: ICollectionView["config"]; name?: string; position?: string }
  >({
    mutationFn: (data) => updateView(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collection-info", collectionPageId],
      });
      queryClient.invalidateQueries({
        queryKey: ["collection-rows", collectionPageId],
      });
    },
  });
}
