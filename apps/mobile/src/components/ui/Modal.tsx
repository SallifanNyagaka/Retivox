/**
 * Reusable Retivox bottom sheet modal.
 *
 * Slides from the bottom, darkens the background, respects safe areas and the
 * keyboard, and provides a drag handle plus close button.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Modal as NativeModal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { Button } from './Button'

export type ModalProps = {
  visible: boolean
  title: string
  children: ReactNode
  onClose: () => void
  closeLabel?: string
}

/**
 * Renders a bottom sheet modal.
 *
 * @param props - Modal props.
 * @returns Native modal element.
 */
export function Modal({ visible, title, children, onClose, closeLabel = 'Close' }: ModalProps) {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const translateY = useRef(new Animated.Value(420)).current

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : 420,
      duration: 220,
      useNativeDriver: true,
    }).start()
  }, [translateY, visible])

  return (
    <NativeModal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable onPress={onClose} style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]} />
        <Animated.View
          style={[
            styles.sheet,
            theme.shadows.raised,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderTopLeftRadius: theme.radii.sheet,
              borderTopRightRadius: theme.radii.sheet,
              paddingBottom: insets.bottom + theme.spacing.lg,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.typography.sizes.xl }]}>{title}</Text>
            <Button label={closeLabel} onPress={onClose} size="sm" variant="outline" />
          </View>
          <View style={styles.content}>{children}</View>
        </Animated.View>
      </KeyboardAvoidingView>
    </NativeModal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    marginTop: 18,
  },
  handle: {
    alignSelf: 'center',
    borderRadius: 999,
    height: 4,
    marginBottom: 16,
    width: 44,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: 1,
    maxHeight: '90%',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  title: {
    flex: 1,
    fontWeight: '700',
    paddingRight: 12,
  },
})
