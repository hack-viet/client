//
//  KBImageTextView.m
//  Keybase
//
//  Created by Gabriel on 2/18/15.
//  Copyright (c) 2015 Gabriel Handford. All rights reserved.
//

#import "KBImageTextView.h"
#import "NSView+KBView.h"

@interface KBImageTextView ()
@property KBImageView *imageView;
@property KBLabel *titleLabel;
@property KBLabel *infoLabel;
@property KBBox *border;

@property NSImage *image;
@property NSImage *imageTinted;
@end

@implementation KBImageTextView

- (void)viewInit {
  [super viewInit];
  [self kb_setBackgroundColor:NSColor.clearColor];

  _imageView = [[KBImageView alloc] init];
  [self addSubview:_imageView];

  _titleLabel = [[KBLabel alloc] init];
  [self addSubview:_titleLabel];

  _infoLabel = [[KBLabel alloc] init];
  [self addSubview:_infoLabel];

  _border = [KBBox line];
  _border.position = KBBoxPositionNone;
  [self addSubview:_border];

  YOSelf yself = self;
  self.viewLayout = [YOLayout layoutWithLayoutBlock:^(id<YOLayout> layout, CGSize size) {
    CGFloat x = 10;
    CGFloat y = 8;

    CGFloat minY = 0;
    if (yself.imageView.image || yself.imageSize.width > 0) {
      CGRect imageViewFrame = [layout setFrame:CGRectMake(x, y, MAX(40, yself.imageSize.width), MAX(40, yself.imageSize.height)) view:yself.imageView];
      x += 50;
      minY = imageViewFrame.origin.y + imageViewFrame.size.height;
    }

    y += [layout sizeToFitVerticalInFrame:CGRectMake(x, y, size.width - x, 0) view:yself.titleLabel].size.height + 2;
    y += [layout sizeToFitVerticalInFrame:CGRectMake(x, y, size.width - x, 0) view:yself.infoLabel].size.height;

    y = MAX(y, minY) + 8;

    [yself.border layoutForPositionWithLayout:layout size:size];
    return CGSizeMake(size.width, y);
  }];
}

- (void)setTitle:(NSString *)title info:(NSString *)info image:(NSImage *)image {
  [self.titleLabel setText:title font:KBAppearance.currentAppearance.boldTextFont color:KBAppearance.currentAppearance.textColor alignment:NSLeftTextAlignment];
  [self.infoLabel setText:info style:KBTextStyleSecondaryText];
  self.imageView.image = image;
  [self setNeedsLayout];
}

- (void)setTitle:(NSString *)title info:(NSString *)info imageURLString:(NSString *)imageURLString imageSize:(CGSize)imageSize {
  [self.titleLabel setText:title font:KBAppearance.currentAppearance.boldTextFont color:KBAppearance.currentAppearance.textColor alignment:NSLeftTextAlignment];
  [self.infoLabel setText:info style:KBTextStyleSecondaryText];
  self.imageSize = imageSize;
  [self.imageView setImageWithURL:[NSURL URLWithString:imageURLString] placeholderImage:nil];
  self.image = nil;
  self.imageTinted = nil;
  [self setNeedsLayout];
}

- (void)setBackgroundStyle:(NSBackgroundStyle)backgroundStyle {
  id<KBAppearance> appearance = (backgroundStyle == NSBackgroundStyleDark ? KBAppearance.darkAppearance : KBAppearance.lightAppearance);
  [self.titleLabel setFont:appearance.boldTextFont color:appearance.textColor];
  [self.infoLabel setStyle:KBTextStyleSecondaryText options:0 appearance:appearance];

  if (self.tintImageForStyle) {
    if (!self.image) {
      self.image = self.imageView.image;
      self.imageTinted = [self.imageView imageTintedWithColor:NSColor.whiteColor];
    }
    if (backgroundStyle == NSBackgroundStyleDark) {
      self.imageView.image = self.imageTinted;
    } else if (self.image) {
      self.imageView.image = self.image;
    }
  }
  [self setNeedsLayout];
}

@end


@implementation KBImageTextCell

- (void)viewInit {
  [super viewInit];
  self.border.position = KBBoxPositionBottom;
}

@end